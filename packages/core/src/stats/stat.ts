// What a stat is (docs/49-stats.md): a named, versioned measure of the event log over time,
// declared once by whoever owns its events, and computed from the events of a time range
// into hour buckets. Also the helpers compute functions share: hours, spans cut at hour
// edges, an accumulator per hour and dimension, and log-scale bins for distributions.

import type { DatabaseSync } from "node:sqlite";
import type { DataClass, StatDimInfo, StatKind, StatMeasure, StatUnit } from "@cmd/protocol";

export const HOUR = 3_600_000;
/** At most this many dimensions per stat (k1…k4 in stat_buckets). */
export const MAX_DIMS = 4;

/** One bucket a compute function returns: an hour, its dimension values (in the stat's dims order), and what it measured. */
export interface StatRow {
  hour: number;
  keys: string[];
  n: number;
  sum: number;
  min: number | null;
  max: number | null;
  /** Distributions: count per log-scale bin (binOf). */
  bins: Record<number, number> | null;
}

export interface ComputeCtx {
  /** events.sqlite, read-only use. */
  events: DatabaseSync;
  /** views.sqlite (turns, sessions). */
  views: DatabaseSync;
  /** The project id a folder belongs to ("dir:<repository>"), cached per folder. */
  projectOf(cwd: string | null): string | null;
  /** The workspace a folder belongs to now. */
  workspaceOf(cwd: string | null): string | null;
  /** What a window was (its kind), from its entity. */
  windowKind(id: string): string | null;
  now: number;
}

export interface SampleCtx {
  /** events.sqlite's path, null in memory. */
  eventsFile: string | null;
  viewsFile: string | null;
}

export interface LabelCtx {
  workspaceName(id: string): string | null;
}

export interface DimDef extends StatDimInfo {
  label?(key: string, ctx: LabelCtx): string;
}

export interface StatDef {
  /** "commands.runs": area.measure, lower case. */
  id: string;
  /** Raise when compute changes: the stat's buckets are built again. */
  version: number;
  title: string;
  description: string;
  kind: StatKind;
  unit: StatUnit;
  dims: DimDef[];
  /** Default from the kind: count n, distribution p50, gauge mean, else sum. */
  measure?: StatMeasure;
  good?: "up" | "down";
  /** The data class it reads (Settings → Data says whether it's recorded). */
  class: DataClass;
  /** What changes it: event types (a type, or a prefix ending in "."), the turns view, the sessions view. */
  inputs: { types?: string[]; turns?: boolean; sessions?: boolean };
  /** The longest an input span can be (ms): a range also reads spans that started this much before it. */
  span?: number;
  /** The open hour grows without events (spans still open): recomputed when asked. */
  live?: boolean;
  /**
   * A gauge with no events behind it (memory, the log's size): read every `every` ms and kept as
   * samples in its buckets. The one kind a rebuild can't recover; rebuilds leave it alone.
   */
  sample?: { every: number; read(ctx: SampleCtx): { keys: string[]; value: number }[] };
  /** The events of [from, to) (hour-aligned) as rows. Pure: the same events give the same rows. */
  compute?(from: number, to: number, ctx: ComputeCtx): StatRow[];
  /** Derived, never stored: the share of `of`'s count where `where` holds, among the rows where `among` holds. */
  ratio?: { of: string; where: Record<string, string>; among?: Record<string, string[]> };
}

export const hourOf = (t: number): number => Math.floor(t / HOUR);

export function defaultMeasure(d: Pick<StatDef, "kind" | "measure" | "ratio">): StatMeasure {
  if (d.measure) return d.measure;
  if (d.ratio) return "mean";
  return d.kind === "count" ? "n" : d.kind === "distribution" ? "p50" : d.kind === "gauge" ? "mean" : "sum";
}

/** Splits [at, until) at hour edges, clipped to [from, to): fn(hour, ms inside it). */
export function spanHours(at: number, until: number, from: number, to: number, fn: (hour: number, ms: number) => void): void {
  let s = Math.max(at, from);
  const e = Math.min(until, to);
  while (s < e) {
    const h = hourOf(s);
    const end = Math.min(e, (h + 1) * HOUR);
    fn(h, end - s);
    s = end;
  }
}

/** Log-scale bins, √2 apart: 1 → 0, 2 → 2, 1000 → 19, a day in ms → 52. */
export const binOf = (v: number): number => (v <= 1 ? 0 : Math.floor(2 * Math.log2(v)));
/** A bin's middle value. */
export const binValue = (i: number): number => Math.pow(2, (i + 0.5) / 2);

export function mergeBins(into: Record<number, number>, from: Record<number, number>): Record<number, number> {
  for (const [k, v] of Object.entries(from)) into[+k] = (into[+k] ?? 0) + v;
  return into;
}

/** The value below which a share q of the binned values lie (±20%, a bin's width). */
export function quantile(bins: Record<number, number>, q: number): number {
  const keys = Object.keys(bins).map(Number).sort((a, b) => a - b);
  const total = keys.reduce((s, k) => s + bins[k]!, 0);
  if (!total) return 0;
  let seen = 0;
  for (const k of keys) {
    seen += bins[k]!;
    if (seen >= q * total) return binValue(k);
  }
  return binValue(keys[keys.length - 1]!);
}

/** Rows by hour and dimension values, added up as a compute function finds them. */
export class Acc {
  #rows = new Map<string, StatRow>();

  #row(hour: number, keys: (string | null | undefined)[]): StatRow {
    const ks = keys.map((k) => k ?? "");
    const id = `${hour}\u0000${ks.join("\u0000")}`;
    let r = this.#rows.get(id);
    if (!r) this.#rows.set(id, (r = { hour, keys: ks, n: 0, sum: 0, min: null, max: null, bins: null }));
    return r;
  }

  /** `n` things happened (a count). */
  count(hour: number, keys: (string | null | undefined)[], n = 1): void {
    this.#row(hour, keys).n += n;
  }

  /** An amount (tokens, ms of a span): added to the sum, counted once. */
  add(hour: number, keys: (string | null | undefined)[], amount: number, n = 1): void {
    const r = this.#row(hour, keys);
    r.sum += amount;
    r.n += n;
  }

  /** One value of a distribution or a gauge sample. */
  value(hour: number, keys: (string | null | undefined)[], v: number, binned: boolean): void {
    const r = this.#row(hour, keys);
    r.n += 1;
    r.sum += v;
    r.min = r.min === null ? v : Math.min(r.min, v);
    r.max = r.max === null ? v : Math.max(r.max, v);
    if (binned) {
      r.bins ??= {};
      const b = binOf(v);
      r.bins[b] = (r.bins[b] ?? 0) + 1;
    }
  }

  rows(): StatRow[] {
    return [...this.#rows.values()];
  }
}

/** Every row of a statement for [from, to), as plain objects. */
export function rows<T>(db: DatabaseSync, sql: string, ...params: (number | string | null)[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

/** "dir:/Users/me/src/cmd" → "cmd". */
export const projectLabel = (key: string): string => (key.startsWith("dir:") ? key.slice(key.lastIndexOf("/") + 1) || key.slice(4) : key);
