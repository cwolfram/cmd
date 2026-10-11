// Stats (docs/49-stats.md): numbers about how cmd is used, computed by the core from the
// event log into hour buckets and kept current as events arrive. Every stat is declared once
// in the core (stats/builtin.ts); clients list them (stats.catalog) and ask one query shape.

import type { DataClass } from "./events.ts";
import type { WorkspaceId } from "./model.ts";

/** What a bucket keeps (docs/49 "Concepts"): counts and sums add up; gauges keep min, max and mean; distributions keep log-scale bins. */
export type StatKind = "count" | "sum" | "duration" | "gauge" | "distribution";
export type StatUnit = "count" | "ms" | "bytes" | "tokens" | "percent";
/** What a series shows of each bucket: its count, its sum, the mean, the largest, or a quantile (distributions). */
export type StatMeasure = "n" | "sum" | "mean" | "max" | "p50" | "p90";
export type StatGrain = "hour" | "day" | "week" | "month";
/** A named range ends now; "today", "week", "month" and "year" start at the start of the current one (local time). */
export type StatRangeName = "today" | "24h" | "week" | "7d" | "month" | "30d" | "year" | "365d";
export type StatRange = StatRangeName | { from: number; to: number };

export interface StatDimInfo {
  id: string;
  title: string;
  /** Many values (commands, paths, hosts): offered for rankings, not as series. */
  many?: boolean;
}

export interface StatInfo {
  id: string;
  title: string;
  /** One line: what the stat answers. */
  description: string;
  kind: StatKind;
  unit: StatUnit;
  dims: StatDimInfo[];
  /** The measure a series shows unless the query asks for another. */
  measure: StatMeasure;
  /** Which way a change is good, if either (a delta's colour). */
  good?: "up" | "down";
  class: DataClass;
  /** False: its data class isn't recorded (Settings → Data), so it stays empty. */
  available: boolean;
  /** Computed from another stat when asked (a ratio), never stored. */
  derived?: boolean;
}

export interface StatQuery {
  stat: string;
  /** Default "7d". */
  range?: StatRange;
  /** Default from the range: hours for a day, days up to two months, weeks up to a year, then months. */
  grain?: StatGrain;
  /** One series per value of this dimension (the 6 largest, the rest as "other"). */
  by?: string;
  /** Only buckets whose dimensions have these values (dimension id → a value, or any of several). */
  filter?: Record<string, string | string[]>;
  /** Shorthand for filter.workspace. */
  workspaceId?: WorkspaceId;
  measure?: StatMeasure;
  /** Also the range of the same length just before (the delta). */
  compare?: boolean;
  /** A ranking of this many values of `by` over the whole range. */
  top?: number;
}

export interface StatSeries {
  key: string;
  label: string;
  /** Per bucket; null: no data there (before the log starts or past now), 0: nothing happened. */
  values: (number | null)[];
  total: number;
}

export interface StatResult {
  stat: StatInfo;
  from: number;
  to: number;
  grain: StatGrain;
  measure: StatMeasure;
  /** Each bucket's start (local time). */
  buckets: number[];
  /** One series ("total"), or one per value of `by`. */
  series: StatSeries[];
  /** The whole range in the query's measure (for gauges and quantiles: over all of it, not a sum of buckets). */
  total: number;
  /** compare: the range just before. */
  previous?: { total: number; values: (number | null)[] };
  /** Distributions: the whole range's median and 90th percentile. */
  quantiles?: { p50: number; p90: number };
  /** top: the largest values of `by` over the range. */
  ranking?: { key: string; label: string; value: number }[];
  /** The stat's buckets are still being built, or the log is younger than the range: numbers start here. */
  partial?: { since: number };
  asOf: number;
}

/** Stats changed (events recorded, a stat built): those still on screen ask again. Part of CoreEvent (rpc.ts). */
export type StatsEvent = { type: "stats.changed"; stats: string[] };

/** Stats' RPC methods, part of `Methods` (rpc.ts). */
export interface StatsMethods {
  /** Every stat cmd keeps (docs/49): what it measures, its unit and dimensions, and whether it's recorded. */
  "stats.catalog": { params: {}; result: StatInfo[] };
  /** One stat over a range, by bucket, optionally split, compared or ranked. */
  "stats.query": { params: StatQuery; result: StatResult };
  /** Several queries in one call (a page of stats). */
  "stats.queryMany": { params: { queries: StatQuery[] }; result: StatResult[] };
  /** Build a stat's buckets again from the events (all stats if none named); returns the stats rebuilding. */
  "stats.rebuild": { params: { stat?: string }; result: { stats: string[] } };
}
