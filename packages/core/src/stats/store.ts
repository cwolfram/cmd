// Where stats keep their buckets (docs/49 "Storage"): one row per stat, UTC hour and
// dimension values in views.sqlite, so deleting the file costs a rebuild and no more.
// stat_meta says which version each stat was built with and how far down the build got.
// Hours older than the oldest event are kept on a rebuild: counts outlive pruned events.

import type { StatementSync } from "node:sqlite";
import type { ViewsStore } from "../data/views/views.ts";
import { MAX_DIMS, type StatRow } from "./stat.ts";

const KEYS = Array.from({ length: MAX_DIMS }, (_, i) => `k${i + 1}`);
const SQL = `
  CREATE TABLE IF NOT EXISTS stat_buckets (
    stat TEXT NOT NULL,
    hour INTEGER NOT NULL,
    ${KEYS.map((k) => `${k} TEXT NOT NULL DEFAULT ''`).join(",\n    ")},
    n REAL NOT NULL DEFAULT 0,
    sum REAL NOT NULL DEFAULT 0,
    min REAL,
    max REAL,
    bins TEXT,
    PRIMARY KEY (stat, hour, ${KEYS.join(", ")})
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS stat_meta (
    stat TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    built_to INTEGER,
    floor INTEGER
  );
`;

/** A stat's build state: built with `version`; buckets from `builtTo` (an hour) up are current, null: all of them; `floor`: its oldest event's hour. */
export interface StatMeta {
  version: number;
  builtTo: number | null;
  floor: number | null;
}

/** A filter on a dimension: its position and the values it may have. */
export interface KeyFilter {
  idx: number;
  values: string[];
}

export class StatsStore {
  #views: ViewsStore;

  constructor(views: ViewsStore) {
    this.#views = views;
    views.ensure("stats", 1, ["stat_buckets", "stat_meta"], SQL);
  }

  #stmt(sql: string): StatementSync {
    return this.#views.stmt(sql);
  }

  meta(stat: string): StatMeta | null {
    const r = this.#stmt(`SELECT version, built_to AS builtTo, floor FROM stat_meta WHERE stat = ?`).get(stat) as StatMeta | undefined;
    return r ?? null;
  }

  setMeta(stat: string, m: StatMeta): void {
    this.#stmt(`INSERT INTO stat_meta (stat, version, built_to, floor) VALUES (?, ?, ?, ?) ON CONFLICT(stat) DO UPDATE SET version = excluded.version, built_to = excluded.built_to, floor = excluded.floor`).run(stat, m.version, m.builtTo, m.floor);
  }

  /** Replaces a stat's buckets in [fromHour, toHour) with `rows`, in one transaction. */
  replace(stat: string, fromHour: number, toHour: number, rows: StatRow[]): void {
    this.#views.transaction(() => {
      this.#stmt(`DELETE FROM stat_buckets WHERE stat = ? AND hour >= ? AND hour < ?`).run(stat, fromHour, toHour);
      const ins = this.#stmt(`INSERT INTO stat_buckets (stat, hour, ${KEYS.join(", ")}, n, sum, min, max, bins) VALUES (?, ?, ${KEYS.map(() => "?").join(", ")}, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET n = n + excluded.n, sum = sum + excluded.sum`);
      for (const r of rows) {
        if (r.hour < fromHour || r.hour >= toHour) continue;
        const keys = KEYS.map((_, i) => r.keys[i] ?? "");
        ins.run(stat, r.hour, ...keys, r.n, r.sum, r.min, r.max, r.bins ? JSON.stringify(r.bins) : null);
      }
    });
  }

  /** A stat's buckets in [fromHour, toHour) whose dimensions pass the filters. */
  read(stat: string, fromHour: number, toHour: number, filters: KeyFilter[] = []): StatRow[] {
    const where = filters.map((f) => `k${f.idx + 1} IN (${f.values.map(() => "?").join(", ")})`);
    const sql = `SELECT hour, ${KEYS.join(", ")}, n, sum, min, max, bins FROM stat_buckets WHERE stat = ? AND hour >= ? AND hour < ?${where.map((w) => ` AND ${w}`).join("")}`;
    const raw = this.#views.db.prepare(sql).all(stat, fromHour, toHour, ...filters.flatMap((f) => f.values)) as Record<string, string | number | null>[];
    return raw.map((r) => ({ hour: r.hour as number, keys: KEYS.map((k) => r[k] as string), n: r.n as number, sum: r.sum as number, min: r.min as number | null, max: r.max as number | null, bins: r.bins ? (JSON.parse(r.bins as string) as Record<number, number>) : null }));
  }

  /** The oldest hour a stat has a bucket for. */
  oldest(stat: string): number | null {
    return (this.#stmt(`SELECT min(hour) AS h FROM stat_buckets WHERE stat = ?`).get(stat) as { h: number | null }).h;
  }

  /** Deletes the buckets whose dimension `idx` is `value` (a forgotten project or session), every hour. */
  deleteKey(stat: string, idx: number, value: string): number {
    return Number(this.#views.db.prepare(`DELETE FROM stat_buckets WHERE stat = ? AND k${idx + 1} = ?`).run(stat, value).changes);
  }

  /** Forgets a stat entirely (a stat no longer declared). */
  drop(stat: string): void {
    this.#stmt(`DELETE FROM stat_buckets WHERE stat = ?`).run(stat);
    this.#stmt(`DELETE FROM stat_meta WHERE stat = ?`).run(stat);
  }

  stats(): string[] {
    return (this.#stmt(`SELECT stat FROM stat_meta`).all() as { stat: string }[]).map((r) => r.stat);
  }
}
