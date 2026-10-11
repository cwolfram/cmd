// Answering a stat query from hour buckets (docs/49 "Query"): the range and its buckets in
// local time (days and weeks are cut here, so changing time zone needs no rebuild), the
// series per dimension value, totals in the asked measure, the previous period and rankings.
// Pure: tests give it rows and a clock.

import type { StatGrain, StatMeasure, StatRange, StatSeries } from "@cmd/protocol";
import { HOUR, hourOf, mergeBins, quantile, type StatRow } from "./stat.ts";

const DAY = 24 * HOUR;

/** The first day of the week where the Mac is (1 Monday … 7 Sunday). */
export function weekStart(): number {
  try {
    const loc = new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale) as Intl.Locale & { getWeekInfo?(): { firstDay: number }; weekInfo?: { firstDay: number } };
    return loc.getWeekInfo?.().firstDay ?? loc.weekInfo?.firstDay ?? 1;
  } catch {
    return 1;
  }
}

/** The start of the grain period `t` falls in, local time. */
export function startOf(t: number, grain: StatGrain, firstDay = weekStart()): number {
  const d = new Date(t);
  if (grain === "hour") return hourOf(t) * HOUR;
  d.setHours(0, 0, 0, 0);
  if (grain === "week") d.setDate(d.getDate() - ((d.getDay() - (firstDay % 7) + 7) % 7));
  if (grain === "month") d.setDate(1);
  return d.getTime();
}

/** `t` moved by `n` grain periods, local time (DST-safe for days and up). */
export function shift(t: number, grain: StatGrain | "year", n: number): number {
  if (grain === "hour") return t + n * HOUR;
  const d = new Date(t);
  if (grain === "day") d.setDate(d.getDate() + n);
  else if (grain === "week") d.setDate(d.getDate() + 7 * n);
  else if (grain === "month") d.setMonth(d.getMonth() + n);
  else d.setFullYear(d.getFullYear() + n);
  return d.getTime();
}

const ROLLING = { "24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY, "365d": 365 * DAY } as const;
const GRAIN_MS: Record<StatGrain, number> = { hour: HOUR, day: DAY, week: 7 * DAY, month: 30 * DAY };

export interface Window {
  /** Where the buckets start and end (the whole period for a calendar range, so an axis shows all of it). */
  from: number;
  to: number;
  grain: StatGrain;
  buckets: number[];
  /** The same buckets one period earlier (compare). */
  previous: number[];
}

/** The default grain for a span: hours up to two days, days up to two months, weeks up to a year, then months. */
export function grainFor(ms: number): StatGrain {
  return ms <= 2 * DAY ? "hour" : ms <= 62 * DAY ? "day" : ms <= 371 * DAY ? "week" : "month";
}

/** A range's buckets at `now`: calendar ranges cover their whole period, rolling ones the last N buckets including the current. */
export function windowOf(range: StatRange, grain: StatGrain | undefined, now: number, firstDay = weekStart()): Window {
  let from: number;
  let to: number;
  let back: (t: number) => number;
  if (typeof range === "object") {
    from = range.from;
    to = range.to;
    const len = to - from;
    back = (t) => t - len;
  } else {
    const cal = { today: "day", week: "week", month: "month", year: "year" } as const;
    if (range in cal) {
      const unit = cal[range as keyof typeof cal];
      from = unit === "year" ? new Date(new Date(now).getFullYear(), 0, 1).getTime() : startOf(now, unit, firstDay);
      to = shift(from, unit, 1);
      back = (t) => shift(t, unit, -1);
    } else {
      // The last N buckets, the current one included.
      const len = ROLLING[range as keyof typeof ROLLING];
      const g = grain ?? grainFor(len);
      to = shift(startOf(now, g, firstDay), g, 1);
      from = shift(to, g, -Math.max(1, Math.round(len / GRAIN_MS[g])));
      back = (t) => shift(t, g, -Math.max(1, Math.round(len / GRAIN_MS[g])));
    }
  }
  const g = grain ?? grainFor(to - from);
  const buckets: number[] = [];
  for (let t = startOf(from, g, firstDay); t < to && buckets.length < 5000; t = shift(t, g, 1)) buckets.push(t);
  return { from, to, grain: g, buckets, previous: buckets.map(back) };
}

/** Index of the bucket `t` falls in (the last start ≤ t), or -1 before the first / at or after `end`. */
export function bucketIndex(starts: number[], end: number, t: number): number {
  if (!starts.length || t < starts[0]! || t >= end) return -1;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** What rows add up to, before a measure is taken. */
export interface Agg {
  n: number;
  sum: number;
  max: number | null;
  bins: Record<number, number> | null;
}

export const emptyAgg = (): Agg => ({ n: 0, sum: 0, max: null, bins: null });

export function addRow(a: Agg, r: StatRow): Agg {
  a.n += r.n;
  a.sum += r.sum;
  if (r.max !== null) a.max = a.max === null ? r.max : Math.max(a.max, r.max);
  if (r.bins) a.bins = mergeBins(a.bins ?? {}, r.bins);
  return a;
}

export function measureOf(a: Agg, m: StatMeasure): number {
  switch (m) {
    case "n":
      return a.n;
    case "sum":
      return a.sum;
    case "mean":
      return a.n ? a.sum / a.n : 0;
    case "max":
      return a.max ?? 0;
    case "p50":
      return a.bins ? quantile(a.bins, 0.5) : 0;
    case "p90":
      return a.bins ? quantile(a.bins, 0.9) : 0;
  }
}

/** Measures whose bucket values add up to the total (others are taken over the whole range). */
export const additive = (m: StatMeasure): boolean => m === "n" || m === "sum";

/** How many series a split shows before the rest become "other". */
export const SERIES_MAX = 6;

/**
 * Rows into series over `starts` (ending at `end`): one "total", or one per value of the
 * key at `byIdx` (the largest SERIES_MAX, the rest as "other"). Buckets before `since` or
 * starting after `now` are null.
 */
export function toSeries(rows: StatRow[], starts: number[], end: number, m: StatMeasure, byIdx: number | null, label: (key: string) => string, o: { since: number | null; now: number }): { series: StatSeries[]; total: number; all: Agg } {
  const groups = new Map<string, { aggs: Agg[]; all: Agg }>();
  const all = emptyAgg();
  for (const r of rows) {
    const i = bucketIndex(starts, end, r.hour * HOUR);
    if (i < 0) continue;
    const key = byIdx === null ? "total" : (r.keys[byIdx] ?? "");
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { aggs: starts.map(emptyAgg), all: emptyAgg() }));
    addRow(g.aggs[i]!, r);
    addRow(g.all, r);
    addRow(all, r);
  }
  const nullAt = starts.map((s, i) => (o.since !== null && (starts[i + 1] ?? end) <= o.since) || s > o.now);
  let entries = [...groups.entries()].sort((a, b) => measureOf(b[1].all, m) - measureOf(a[1].all, m));
  if (byIdx !== null && entries.length > SERIES_MAX) {
    const rest = entries.slice(SERIES_MAX - 1);
    const other = { aggs: starts.map(emptyAgg), all: emptyAgg() };
    for (const [, g] of rest) {
      g.aggs.forEach((a, i) => addAgg(other.aggs[i]!, a));
      addAgg(other.all, g.all);
    }
    entries = [...entries.slice(0, SERIES_MAX - 1), ["\u0000other", other]];
  }
  if (!entries.length) entries = [[byIdx === null ? "total" : "", { aggs: starts.map(emptyAgg), all: emptyAgg() }]];
  const series = entries.map(([key, g]) => ({
    key: key === "\u0000other" ? "other" : key,
    label: key === "\u0000other" ? "Other" : byIdx === null ? "Total" : label(key),
    values: g.aggs.map((a, i) => (nullAt[i] ? null : measureOf(a, m))),
    total: measureOf(g.all, m),
  }));
  if (byIdx !== null && !groups.size) series.length = 0;
  return { series, total: measureOf(all, m), all };
}

function addAgg(a: Agg, b: Agg): void {
  a.n += b.n;
  a.sum += b.sum;
  if (b.max !== null) a.max = a.max === null ? b.max : Math.max(a.max, b.max);
  if (b.bins) a.bins = mergeBins(a.bins ?? {}, b.bins);
}

/** The largest values of the key at `idx` over all rows. */
export function ranking(rows: StatRow[], idx: number, m: StatMeasure, top: number, label: (key: string) => string): { key: string; label: string; value: number }[] {
  const by = new Map<string, Agg>();
  for (const r of rows) {
    const k = r.keys[idx] ?? "";
    addRow(by.get(k) ?? (by.set(k, emptyAgg()), by.get(k)!), r);
  }
  return [...by.entries()]
    .map(([key, a]) => ({ key, label: label(key), value: measureOf(a, m) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, top);
}
