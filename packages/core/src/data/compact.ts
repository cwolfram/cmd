// What the event log keeps less of, applied once to a log written before
// (meta('compact') < COMPACT_VERSION): Claude's bookkeeping rows deleted,
// transcript lines cut the way the reader cuts them now (tool output and input,
// thinking signatures; copies the class's cap broke dropped), tool hooks without
// what the tool printed, the indexes of mostly-empty columns made partial; then
// one VACUUM that turns on incremental auto-vacuum, so pages freed later
// (retention, forgets) go back to the disk a step at a time (reclaim) instead of
// staying in the file for good. On the author's log: 2.9 GB, a third of it free
// pages and most of the rest tool output. Runs as the data service opens the
// log, before the core listens: 20 s on that log, once, shown in the boot report
// (kernel/boot.ts, docs/50); on a new one it costs nothing and gives the file the
// same shape. Without room for the vacuum, it does the rest and vacuums next launch.

import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { logger } from "@cmd/protocol/node";
import { bootStep, type BootProgress } from "../kernel/boot.ts";
import { freeBytes, gb } from "../lib/disk.ts";
import { liveBytes } from "./migrations.ts";
import { storedPayload } from "../agents/activity/normalize.ts";
import { keptLine, trimLine } from "./sources/transcripts.ts";
import type { DataStore } from "./store.ts";

const log = logger("data");

/** Bump to run the pass again over logs that had the one before. */
export const COMPACT_VERSION = 1;

/** Indexes of columns most rows leave empty: only the rows that have one (a lookup is always `col = ?`). */
const PARTIAL_INDEXES = `
DROP INDEX IF EXISTS events_agent;
DROP INDEX IF EXISTS events_workspace_at;
CREATE INDEX events_agent ON events(agent_id, seq) WHERE agent_id IS NOT NULL;
CREATE INDEX events_workspace_at ON events(workspace_id, at) WHERE workspace_id IS NOT NULL;
`;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

/** Brings the log to COMPACT_VERSION when it's behind; returns whether it ran. */
export function compactLog(store: DataStore): boolean {
  const db = store.db;
  if (Number(store.meta("compact") ?? 0) >= COMPACT_VERSION) return false;
  const t0 = Date.now();
  const before = pages(db);
  const done = { other: 0, lines: 0, hooks: 0 };
  // Reported only when there's something to wait for: a new or small log is done in a blink.
  const boot = before.total > 1000 ? bootStep("compact", "Shrinking recorded data") : null;
  try {
    store.transaction(() => {
      done.other = Number(db.prepare(`DELETE FROM events WHERE type = 'transcript.other' AND source >= 'transcript:claude' AND source < 'transcript:claudf'`).run().changes);
      done.lines = trimTranscripts(store, boot);
      boot?.detail("Tidying up");
      done.hooks = slimToolHooks(db);
      db.exec(PARTIAL_INDEXES);
      // Blobs only the deleted and rewritten rows held.
      db.exec(`UPDATE blobs SET refs = 0; UPDATE blobs SET refs = x.n FROM (SELECT blob, COUNT(*) AS n FROM events WHERE blob IS NOT NULL GROUP BY blob) AS x WHERE blobs.hash = x.blob; DELETE FROM blobs WHERE refs <= 0`);
    });
    if (done.other || done.lines || done.hooks) log.info("event log: kept less of what was recorded before", { ...done, ms: Date.now() - t0 });
    // A VACUUM writes a temporary copy and a journal: about twice the pages in use.
    const need = liveBytes(db) * 2;
    if (store.file !== ":memory:" && freeBytes(path.dirname(store.file)) < need) {
      log.warn(`event log: not vacuumed, it needs about ${gb(need)} free; trying again next launch`);
      return true;
    }
    boot?.detail("Freeing disk space");
    try {
      vacuum(db, store.file);
    } catch (err) {
      // Another program has the file open, or the disk filled after all: the rows are done, the vacuum waits for next launch.
      log.warn(`event log: not vacuumed (${(err as Error).message}); trying again next launch`);
      // Back in WAL if the switch back failed too (every open sets it again anyway).
      try {
        db.exec(`PRAGMA journal_mode = WAL`);
      } catch {}
      return true;
    }
  } finally {
    boot?.end();
  }
  store.setMeta("compact", String(COMPACT_VERSION));
  const after = pages(db);
  if (boot) log.info("event log: compacted", { mb: [mb(before.total * before.size), mb(after.total * after.size)], ms: Date.now() - t0 });
  return true;
}

/** Rows of a query, a page at a time by seq (rows are rewritten as they're read). */
function* paged<T extends { seq: number }>(db: DatabaseSync, sql: string): Generator<T> {
  const page = db.prepare(`${sql} AND seq > ? ORDER BY seq LIMIT 2000`);
  for (let after = 0; ; ) {
    const rows = page.all(after) as unknown as T[];
    if (!rows.length) return;
    yield* rows;
    after = rows.at(-1)!.seq;
  }
}

/**
 * Transcript lines kept whole before: cut the way the reader cuts them now
 * (keptLine), inline again when that's small; a copy the class's cap cut short
 * (it doesn't parse, nothing could read it) dropped.
 */
function trimTranscripts(store: DataStore, boot: BootProgress | null): number {
  const db = store.db;
  const update = db.prepare(`UPDATE events SET data = jsonb(?), blob = ? WHERE seq = ?`);
  const BIG = `type >= 'transcript.' AND type < 'transcript/' AND blob IS NOT NULL`;
  const total = boot ? (db.prepare(`SELECT COUNT(*) AS n FROM events WHERE ${BIG}`).get() as { n: number }).n : 0;
  let n = 0;
  let seen = 0;
  for (const r of paged<{ seq: number; data: string; blob: string }>(db, `SELECT seq, json(data) AS data, blob FROM events WHERE ${BIG}`)) {
    boot?.progress(++seen, total);
    const raw = store.blob(r.blob)?.toString("utf8") ?? "";
    const data = JSON.parse(r.data) as Obj;
    let line: unknown = null;
    try {
      line = JSON.parse(raw);
    } catch {}
    if (!isObj(line)) {
      update.run(JSON.stringify({ ...data, cut: true }), null, r.seq), n++;
      continue;
    }
    const { trimmed, kept, big } = keptLine(line, raw);
    if (!trimmed) continue;
    data.cut = true;
    if (!big) Object.assign(data, isObj(trimmed.payload) && !isObj(trimmed.message) ? { payload: trimmed.payload } : { message: trimmed.message });
    update.run(JSON.stringify(data), big && kept ? store.putBlob(kept) : null, r.seq), n++;
  }
  // Small lines kept inline: only thinking signatures and Codex's encrypted reasoning are worth the rewrite.
  for (const r of paged<{ seq: number; data: string }>(db, `SELECT seq, json(data) AS data FROM events WHERE type >= 'transcript.' AND type < 'transcript/' AND blob IS NULL AND (instr(data, CAST('signature' AS BLOB)) > 0 OR instr(data, CAST('encrypted_content' AS BLOB)) > 0)`)) {
    const data = JSON.parse(r.data) as Obj;
    const trimmed = trimLine({ message: data.message, payload: data.payload });
    if (!trimmed) continue;
    if (isObj(trimmed.message)) data.message = trimmed.message;
    if (isObj(trimmed.payload)) data.payload = trimmed.payload;
    update.run(JSON.stringify({ ...data, cut: true }), null, r.seq), n++;
  }
  return n;
}

/** Tool hooks: the answer reduced to how the call went, and no copy of the whole payload. */
function slimToolHooks(db: DatabaseSync): number {
  const update = db.prepare(`UPDATE events SET data = jsonb(?), blob = NULL WHERE seq = ?`);
  const rows = db.prepare(`SELECT seq, json(data) AS data FROM events WHERE type = 'agent.hook' AND json_extract(data, '$.payload.tool_name') IS NOT NULL AND (blob IS NOT NULL OR json_type(data, '$.payload.tool_response') IS NOT NULL)`).all() as { seq: number; data: string }[];
  for (const r of rows) {
    const data = JSON.parse(r.data) as Obj;
    if (isObj(data.payload)) data.payload = storedPayload(data.payload);
    update.run(JSON.stringify(data), r.seq);
  }
  return rows.length;
}

/** Rewrites the file without its free pages, with incremental auto-vacuum from then on. */
function vacuum(db: DatabaseSync, file: string): void {
  // Outside WAL, a VACUUM writes the file once instead of the whole log into the WAL first and then again.
  const left = file !== ":memory:" && (db.prepare(`PRAGMA journal_mode = DELETE`).get() as { journal_mode: string }).journal_mode !== "wal";
  try {
    db.exec(`PRAGMA auto_vacuum = INCREMENTAL; VACUUM`);
  } finally {
    if (left) db.exec(`PRAGMA journal_mode = WAL`);
  }
}

/**
 * Gives up to `max` free pages back to the disk (incremental auto-vacuum);
 * returns whether more are left. A no-op on a log without auto-vacuum.
 */
export function reclaim(db: DatabaseSync, max: number): boolean {
  if ((db.prepare(`PRAGMA auto_vacuum`).get() as { auto_vacuum: number }).auto_vacuum !== 2) return false;
  db.prepare(`PRAGMA incremental_vacuum(${Math.max(1, Math.floor(max))})`).all();
  return pages(db).free > 0;
}

function pages(db: DatabaseSync): { total: number; free: number; size: number } {
  const n = (p: string) => Object.values(db.prepare(`PRAGMA ${p}`).get() as Record<string, number>)[0]!;
  return { total: n("page_count"), free: n("freelist_count"), size: n("page_size") };
}

const mb = (b: number) => Math.round(b / 1048576);
