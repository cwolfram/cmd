// Numbers as people read them (docs/49 "Pieces"): one formatter per stat unit, shared by the
// CLI and the app (which hands them to the kit's charts). Durations as "3h 12m", counts and
// tokens compact ("1.2K", "2.3M"), bytes in binary steps, deltas as "+18%" or "new".

import type { StatUnit } from "./stats.ts";

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const one = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

/** 3h 12m, 48m, 12s, 120ms; `short`: only the largest unit ("3h"), for axis ticks. */
export function formatDuration(ms: number, short = false): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(ms / 60_000);
  if (m < 60) return short || s % 60 === 0 || m >= 10 ? `${m}m` : `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return short || m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return short || h % 24 === 0 ? `${d}d` : `${d}d ${h % 24}h`;
}

export function formatBytes(b: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) (b /= 1024), i++;
  return `${i ? one.format(b) : whole.format(b)} ${units[i]}`;
}

/** A value in its unit; `short` for ticks and tight places (compact everywhere). */
export function formatValue(v: number, unit: StatUnit, short = false): string {
  switch (unit) {
    case "ms":
      return formatDuration(v, short);
    case "bytes":
      return formatBytes(v);
    case "percent":
      return `${v < 10 && v > 0 && !short ? one.format(v) : whole.format(v)}%`;
    default:
      return Math.abs(v) >= 10_000 || (short && Math.abs(v) >= 1000) ? compact.format(v) : v % 1 ? one.format(v) : whole.format(v);
  }
}

/** The change from `prev` to `cur`: "+18%", "−4%", "new" (from nothing), "" (nothing either time); percentages change by points. */
export function formatDelta(cur: number, prev: number, unit?: StatUnit): string {
  if (unit === "percent") {
    const d = cur - prev;
    return Math.abs(d) < 0.05 ? "±0" : `${d > 0 ? "+" : "−"}${one.format(Math.abs(d))} pt`;
  }
  if (!prev) return cur ? "new" : "";
  const p = ((cur - prev) / prev) * 100;
  if (Math.abs(p) < 0.5) return "±0%";
  return `${p > 0 ? "+" : "−"}${Math.abs(p) >= 10 ? whole.format(Math.abs(p)) : one.format(Math.abs(p))}%`;
}

/** Which way a delta went: up, down or flat. */
export const trendOf = (cur: number, prev: number): "up" | "down" | "flat" => (Math.abs(cur - prev) <= Math.abs(prev) * 0.005 ? "flat" : cur > prev ? "up" : "down");

/** ▁▂▃▄▅▆▇█ for a series; null values as a space. */
export function sparkline(values: (number | null)[]): string {
  const xs = values.filter((v): v is number => v !== null);
  const max = Math.max(0, ...xs);
  const bars = "▁▂▃▄▅▆▇█";
  return values.map((v) => (v === null ? " " : max ? bars[Math.min(7, Math.round((v / max) * 7))] : bars[0])).join("");
}

/** A bar `width` cells wide at `share` (0…1), in eighth blocks. */
export function blockBar(share: number, width: number): string {
  const eighths = Math.round(Math.max(0, Math.min(1, share)) * width * 8);
  const part = " ▏▎▍▌▋▊▉"[eighths % 8]!;
  return "█".repeat(Math.floor(eighths / 8)) + (eighths % 8 ? part : "");
}
