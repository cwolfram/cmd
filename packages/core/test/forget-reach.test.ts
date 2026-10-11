// Forget reaches everything (AR1-06-07, AR1-16-02): a forgotten session's or
// project's entities and links, the bytes of the file, live queries, re-reads
// after a forget by time, the journal's days and weeks, summary files and the
// Workspace Actions descriptions.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, JOURNAL_SCHEMA, type JournalDay, type Settings } from "@cmd/protocol";
import { DataService } from "../src/data/service.ts";
import { JournalStore } from "../src/journal/store.ts";
import { forgetSummaries } from "../src/summaries/service.ts";
import { DescribedCache } from "../src/actions/describe.ts";
import { DatabaseSync } from "node:sqlite";
import { rmTemp } from "./tmp.ts";

const settings = { ...DEFAULT_SETTINGS } as Settings;
const service = (file: string | null = null) => new DataService({ file, recordedBy: "test", settings: () => settings });
const msg = (id: string, session: string, at = 1, text = "hi") => ({ id, at, type: "transcript.message" as const, source: "t", sessionId: session, projectId: "dir:/p", text, data: { role: "user" } });
const DAY = 86400_000;

describe("forget, the log's own parts", () => {
  it("deletes a forgotten session's entity and links, and doesn't describe it again", () => {
    const d = service();
    d.record(msg("m1", "claude:s1"));
    d.describe("session", "claude:s1", { title: "t", firstPrompt: "my secret plan" });
    d.link(["session", "claude:s1"], ["project", "dir:/p"], "in");
    d.link(["agent", "a1"], ["session", "claude:s1"], "runs");
    d.describe("agent", "a1", { kind: "claude" });
    d.describe("agent", "a2", { kind: "claude" });
    d.link(["agent", "a2"], ["session", "claude:s1"], "runs");
    d.link(["agent", "a2"], ["pane", "p2"], "ran in");
    d.forget({ sessionId: "claude:s1" });
    expect(d.store.entityOf("session", "claude:s1")).toBeNull();
    expect(d.store.linksOf("session", "claude:s1")).toEqual([]);
    // a1 was known only through the session; a2 also ran in a pane.
    expect(d.store.entityOf("agent", "a1")).toBeNull();
    expect(d.store.entityOf("agent", "a2")).not.toBeNull();
    d.describe("session", "claude:s1", { title: "t again" });
    d.link(["session", "claude:s1"], ["project", "dir:/p"], "in");
    expect(d.store.entityOf("session", "claude:s1")).toBeNull();
    expect(d.store.linksOf("session", "claude:s1")).toEqual([]);
  });

  it("forgets a project's sessions with it", () => {
    const d = service();
    d.record(msg("m1", "claude:s1"));
    d.describe("session", "claude:s1", { title: "t" });
    d.link(["session", "claude:s1"], ["project", "dir:/p"], "in");
    d.forget({ projectId: "dir:/p" });
    expect(d.store.entityOf("project", "dir:/p")).toBeNull();
    expect(d.store.entityOf("session", "claude:s1")).toBeNull();
  });

  it("leaves no byte of what it forgot in the file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmd-forget-bytes-"));
    try {
      const file = path.join(dir, "events.sqlite");
      const d = service(file);
      const marker = "zq7Hx2Lm9Wp4Rt6Yv8Bn1Cd3Fg5Jk0Qs";
      // Many full-text segments (one per transaction), the marker's in the middle: a plain delete leaves its words in them.
      const batch = (b: number) => d.recordAll(Array.from({ length: 200 }, (_, i) => msg(`f${b}-${i}`, "claude:other", b * 1000 + i, `filler ${b} message ${i} words ${b * i}`)));
      for (let b = 0; b < 30; b++) batch(b);
      d.record({ ...msg("secret", "claude:s1", 50_000, `the plan is ${marker}`), content: `short content ${marker}` });
      for (let b = 30; b < 60; b++) batch(b);
      d.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      // The full-text index keeps words lowercased.
      const has = () => [file, `${file}-wal`].some((f) => fs.existsSync(f) && [marker, marker.toLowerCase()].some((m) => fs.readFileSync(f).includes(m)));
      expect(has()).toBe(true);
      expect(d.forget({ sessionId: "claude:s1" })).toBe(1);
      await d.scrubbed();
      d.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      expect(has()).toBe(false);
      // Still searchable for the rest.
      expect(d.query({ text: "filler", limit: 5 })).toHaveLength(5);
      d.dispose();
    } finally {
      rmTemp(dir);
    }
  });

  it("tells subscribers which events went", () => {
    const d = service();
    const s1 = d.record(msg("m1", "claude:s1"))!;
    d.record(msg("m2", "claude:s2"));
    const heard: { seqs?: number[] }[] = [];
    d.on("removed", (r) => heard.push(r));
    d.forget({ sessionId: "claude:s1" });
    expect(heard).toEqual([{ types: ["transcript.message"], count: 1, seqs: [s1.seq] }]);
  });

  it("keeps what a forget by time and type named out when the files are read again", () => {
    const d = service();
    d.recordAll([msg("old", "claude:s", 100), msg("new", "claude:s", 300), { id: "c", at: 100, type: "note", source: "cmd", text: "n", data: { by: "user", agentSession: null } }]);
    d.forget({ before: 200, types: ["transcript."] });
    expect(d.query({}).filter((e) => e.type !== "data.op").map((e) => e.id)).toEqual(["new", "c"]);
    // A reindex reads the transcript again: what came before the time stays out, the rest is news as usual.
    expect(d.recordAll([msg("old", "claude:s", 100), msg("older", "claude:s", 150), msg("later", "claude:s", 400)])).toBe(1);
    expect(d.query({ types: ["transcript."] }).map((e) => e.id)).toEqual(["new", "later"]);
    // A fresh service on the same log knows the range too.
    expect(d.recordAll([{ id: "n2", at: 100, type: "note", source: "cmd", text: "n", data: { by: "user", agentSession: null } }])).toBe(1);
  });
});

const day = (scope: string, date: number, repo: string | null = null): JournalDay => ({
  date,
  scope,
  headline: `${scope} on ${date}`,
  entries: [{ id: "e", kind: "feature", title: "t", summary: "s", outcome: null, start: date, end: date, repo, threads: [], counts: { agents: 0, prompts: 0, commands: 0, commits: 0, pages: 0, files: 0 } }],
  writtenBy: "m",
  writtenAt: 1,
  format: { schema: JOURNAL_SCHEMA, threads: 1, writer: 1 },
  eventsHash: "h",
  inputHash: "i",
  minor: 0,
});

describe("forget, what the journal wrote", () => {
  it("deletes a forgotten project's days, history and weeks", () => {
    const d = service();
    const j = new JournalStore(null, { data: d });
    const t = 10 * DAY;
    d.record({ ...msg("m1", "claude:s1", t + 5 * 3600_000), projectId: "dir:/p" });
    j.saveDay(day("repo:/p", t, "/p"));
    j.saveDay(day("repo:/p", t, "/p")); // the first goes to the history
    j.saveDay(day("all", t - 5 * DAY, "/p")); // names it, on another day
    j.saveDay(day("all", t - 9 * DAY, "/other"));
    j.saveWeek({ start: t - 2 * DAY, scope: "repo:/p", headline: "w", themes: [], days: [] } as never);
    expect(j.history("repo:/p", t)).toHaveLength(1);
    d.forget({ projectId: "dir:/p" });
    expect(j.day("repo:/p", t)).toBeNull();
    expect(j.history("repo:/p", t)).toEqual([]);
    expect(j.week("repo:/p", t - 2 * DAY)).toBeNull();
    expect(j.day("all", t - 5 * DAY)).toBeNull();
    expect(j.day("all", t - 9 * DAY)).not.toBeNull();
  });

  it("deletes the days a forgotten session reaches into, in every scope", () => {
    const d = service();
    const j = new JournalStore(null, { data: d });
    const t = 20 * DAY;
    d.record(msg("m1", "claude:s1", t + 10 * 3600_000));
    j.saveDay(day("all", t));
    j.saveDay(day("workspace:w", t));
    j.saveDay(day("all", t - 3 * DAY));
    d.forget({ sessionId: "claude:s1" });
    expect(j.day("all", t)).toBeNull();
    expect(j.day("workspace:w", t)).toBeNull();
    expect(j.day("all", t - 3 * DAY)).not.toBeNull();
  });

  it("drops days older than retention keeps", () => {
    const now = 400 * DAY;
    const s = { ...DEFAULT_SETTINGS, "data.keepDays": 30 } as Settings;
    const d = new DataService({ file: null, recordedBy: "test", settings: () => s, now: () => now });
    const j = new JournalStore(null, { data: d });
    j.saveDay(day("all", now - 40 * DAY));
    j.saveDay(day("all", now - 10 * DAY));
    d.prune();
    expect(j.day("all", now - 40 * DAY)).toBeNull();
    expect(j.day("all", now - 10 * DAY)).not.toBeNull();
  });
});

describe("forget, summaries and descriptions", () => {
  it("deletes a forgotten session's summary file, recorded or named by it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmd-forget-sum-"));
    try {
      const d = service();
      const recorded = path.join(dir, "proj-2026-10-11-aaaaaaaa.md");
      const older = path.join(dir, "proj-2026-10-01-bbbbbbbb.md");
      const other = path.join(dir, "proj-2026-10-01-cccccccc.md");
      for (const f of [recorded, older, other]) fs.writeFileSync(f, "# summary");
      d.record({ id: `summary:${recorded}`, at: 5, type: "summary.written", source: "cmd", sessionId: "claude:s1", text: "x", data: { path: recorded } });
      d.onForget(({ what }) => forgetSummaries(d, what, dir));
      d.forget({ sessionId: "claude:s1" });
      expect(fs.existsSync(recorded)).toBe(false);
      d.forget({ sessionId: "claude:bbbbbbbb-1111-2222" });
      expect(fs.existsSync(older)).toBe(false);
      expect(fs.existsSync(other)).toBe(true);
      // Forgetting commands alone leaves summaries.
      expect(forgetSummaries(d, { types: ["command"] }, dir)).toBe(0);
    } finally {
      rmTemp(dir);
    }
  });

  it("drops what the model said about a forgotten project's folders", () => {
    const c = new DescribedCache(new DatabaseSync(":memory:"));
    const d = { actions: {}, primary: null, suggested: [] };
    for (const r of ["/p", "/p/sub", "/pp", "/q"]) c.set(r, "h", d);
    expect(c.forget("/p")).toBe(2);
    expect(["/p", "/p/sub", "/pp", "/q"].map((r) => !!c.get(r))).toEqual([false, false, true, true]);
  });
});
