// Stats (docs/49): ranges cut in local time, series and rankings from hour buckets, and the
// service end to end: stats built from recorded events, kept current as events arrive and
// change, ratios, the previous period, rebuilds that keep hours whose events were pruned,
// forgetting a project.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Core } from "../src/kernel/core.ts";
import { bucketIndex, ranking, shift, startOf, toSeries, windowOf } from "../src/stats/query.ts";
import { commandName } from "../src/stats/builtin.ts";
import { Acc, binOf, HOUR, quantile, spanHours, type StatRow } from "../src/stats/stat.ts";
import { fakeFactory } from "./fake-pty.ts";
import { blockBar, formatCompact, formatDelta, formatDuration, formatValue, sparkline } from "@cmd/protocol";

const DAY = 24 * HOUR;
const row = (hour: number, keys: string[], n: number, sum = 0): StatRow => ({ hour, keys, n, sum, min: null, max: null, bins: null });

describe("stat helpers", () => {
  it("cuts spans at hour edges, clipped to the range", () => {
    const got: [number, number][] = [];
    spanHours(0.5 * HOUR, 2.25 * HOUR, 0, 2 * HOUR, (h, ms) => got.push([h, ms]));
    expect(got).toEqual([[0, 0.5 * HOUR], [1, HOUR]]);
  });

  it("finds quantiles from log bins within a bin's width", () => {
    const bins: Record<number, number> = {};
    for (let v = 1; v <= 1000; v++) bins[binOf(v)] = (bins[binOf(v)] ?? 0) + 1;
    expect(quantile(bins, 0.5)).toBeGreaterThan(500 / 1.42);
    expect(quantile(bins, 0.5)).toBeLessThan(500 * 1.42);
    expect(quantile(bins, 0.9)).toBeGreaterThan(900 / 1.42);
  });

  it("adds up rows by hour and dimension values", () => {
    const acc = new Acc();
    acc.count(1, ["a"]);
    acc.count(1, ["a"], 2);
    acc.add(1, ["b"], 50);
    expect(acc.rows().map((r) => [r.keys[0], r.n, r.sum])).toEqual([["a", 3, 0], ["b", 1, 50]]);
  });

  it("names commands by what they run", () => {
    expect(commandName("FOO=1 pnpm -r test --watch")).toBe("pnpm test");
    expect(commandName("/usr/bin/git status")).toBe("git status");
    expect(commandName("ls -la")).toBe("ls");
    expect(commandName("git")).toBe("git");
    expect(commandName(null)).toBe("");
  });
});

describe("stat formats", () => {
  it("writes durations, compact numbers and deltas the same in every locale", () => {
    expect([formatDuration(0), formatDuration(450), formatDuration(48_000), formatDuration(3 * 3600_000 + 12 * 60_000), formatDuration(3 * 3600_000 + 12 * 60_000, true), formatDuration(26 * 3600_000)]).toEqual(["0", "450ms", "48s", "3h 12m", "3h", "1d 2h"]);
    expect([formatCompact(1234), formatCompact(2_345_678), formatCompact(123_456_789)]).toEqual(["1.2K", "2.3M", "123M"]);
    expect([formatValue(12_345, "tokens"), formatValue(6.12, "percent"), formatValue(999, "count")]).toEqual(["12.3K", "6.1%", "999"]);
    expect([formatDelta(118, 100), formatDelta(96, 100), formatDelta(5, 0), formatDelta(0, 0), formatDelta(6.1, 7.3, "percent"), formatDelta(0, 0, "percent")]).toEqual(["+18%", "−4%", "new", "", "−1.2 pt", ""]);
  });

  it("draws sparklines and bars in block characters", () => {
    expect(sparkline([0, 7, null, 14])).toBe("▁▅ █");
    expect(blockBar(0.5, 4)).toBe("██");
    expect(blockBar(1 / 16, 2)).toBe("▏");
  });
});

describe("stat windows", () => {
  const now = new Date(2026, 9, 14, 15, 30).getTime(); // Wednesday 14 Oct 2026, 15:30 local

  it("gives the last 7 days as 7 day buckets ending with today", () => {
    const w = windowOf("7d", undefined, now, 1);
    expect(w.grain).toBe("day");
    expect(w.buckets).toHaveLength(7);
    expect(w.buckets[6]).toBe(new Date(2026, 9, 14).getTime());
    expect(w.to).toBe(new Date(2026, 9, 15).getTime());
    expect(w.previous[0]).toBe(w.buckets[0]! - 7 * DAY);
  });

  it("covers a whole calendar period, hours for today, weeks from the first day of the week", () => {
    const today = windowOf("today", undefined, now, 1);
    expect(today.grain).toBe("hour");
    expect(today.buckets).toHaveLength(24);
    const week = windowOf("week", undefined, now, 1);
    expect(new Date(week.from).getDay()).toBe(1);
    expect(week.buckets).toHaveLength(7);
    expect(new Date(windowOf("week", undefined, now, 7).from).getDay()).toBe(0);
    const year = windowOf("year", undefined, now, 1);
    expect(year.grain).toBe("week");
    expect(new Date(year.previous[10]!).getFullYear()).toBe(2025); // the first week starts in late December
  });

  it("moves by calendar periods", () => {
    expect(new Date(shift(new Date(2026, 0, 31).getTime(), "month", 1)).getMonth()).toBe(2); // JS month overflow, as Date does
    expect(startOf(now, "month")).toBe(new Date(2026, 9, 1).getTime());
  });

  it("finds a bucket by time", () => {
    expect(bucketIndex([0, 10, 20], 30, 15)).toBe(1);
    expect(bucketIndex([0, 10, 20], 30, 30)).toBe(-1);
    expect(bucketIndex([0, 10, 20], 30, -1)).toBe(-1);
  });
});

describe("stat series", () => {
  const starts = [0, 2 * HOUR, 4 * HOUR];
  it("splits by a dimension, the largest first, the rest as Other", () => {
    const rows = ["a", "b", "c", "d", "e", "f", "g", "h"].map((k, i) => row(0, [k], 10 - i));
    const { series, total } = toSeries(rows, starts, 6 * HOUR, "n", 0, (k) => k.toUpperCase(), { since: null, now: 10 * HOUR });
    expect(series.map((s) => s.label)).toEqual(["A", "B", "C", "D", "E", "Other"]);
    expect(series[5]!.total).toBe(5 + 4 + 3);
    expect(total).toBe(10 + 9 + 8 + 7 + 6 + 5 + 4 + 3);
  });

  it("leaves buckets before the data starts and after now empty, not zero", () => {
    const { series } = toSeries([row(3, [], 2)], starts, 6 * HOUR, "n", null, String, { since: 2 * HOUR, now: 3.5 * HOUR });
    expect(series[0]!.values).toEqual([null, 2, null]);
  });

  it("ranks values over the range", () => {
    expect(ranking([row(0, ["x"], 1), row(1, ["y"], 3), row(2, ["x"], 1)], 0, "n", 5, String)).toEqual([{ key: "y", label: "y", value: 3 }, { key: "x", label: "x", value: 2 }]);
  });
});

describe("stats service", () => {
  const core = new Core({ socketPath: "/dev/null", dbPath: null, settingsPath: null, terminals: fakeFactory().factory, pollMs: 0 });
  const now = Date.now();
  const hour = Math.floor(now / HOUR) * HOUR;
  let n = 0;
  const command = (at: number, cmd: string, exitCode: number | null, ms: number | null, projectId = "dir:/src/app", id = `command:${n++}`) =>
    core.data.record({ id, at, ...(ms === null ? {} : { until: at + ms }), type: "command", source: "osc", projectId, workspaceId: "w1", text: cmd, data: { command: cmd, exitCode, cwd: "/src/app", output: null } });

  beforeAll(async () => {
    command(hour - 3 * DAY, "pnpm test", 0, 2000);
    command(hour - 3 * DAY + 60_000, "pnpm test", 1, 4000);
    command(hour - 1 * DAY, "git status", 0, 100);
    command(hour + 1000, "pnpm test", 0, 3000, "dir:/src/other");
    core.stats.start();
    await core.stats.idle();
  });
  afterAll(() => core.close());

  it("lists its stats with what they measure", () => {
    const runs = core.stats.catalog().find((s) => s.id === "commands.runs")!;
    expect(runs).toMatchObject({ kind: "count", unit: "count", measure: "n", available: true });
    expect(runs.dims.map((d) => d.id)).toEqual(["result", "command", "project", "workspace"]);
  });

  it("counts recorded events into buckets, split and ranked", () => {
    const r = core.stats.query({ stat: "commands.runs", range: "7d", by: "result", top: 5 });
    expect(r.total).toBe(4);
    expect(r.buckets).toHaveLength(7);
    expect(Object.fromEntries(r.series.map((s) => [s.label, s.total]))).toEqual({ Passed: 3, Failed: 1 });
    const top = core.stats.query({ stat: "commands.runs", range: "7d", by: "command", top: 5 }).ranking;
    expect(top).toEqual([{ key: "pnpm test", label: "pnpm test", value: 3 }, { key: "git status", label: "git status", value: 1 }]);
    expect(core.stats.query({ stat: "commands.runs", range: "7d", filter: { project: "dir:/src/other" } }).total).toBe(1);
    expect(core.stats.query({ stat: "commands.runs", range: "7d", by: "project" }).series.map((s) => s.label).sort()).toEqual(["app", "other"]);
  });

  it("keeps up as events arrive and change (a command that ends)", async () => {
    command(now, "make build", null, null, "dir:/src/app", "command:live");
    await core.stats.idle();
    expect(core.stats.query({ stat: "commands.runs", range: "today", filter: { result: "running" } }).total).toBe(1);
    command(now, "make build", 2, 5000, "dir:/src/app", "command:live");
    await core.stats.idle();
    expect(core.stats.query({ stat: "commands.runs", range: "today", filter: { result: "running" } }).total).toBe(0);
    expect(core.stats.query({ stat: "commands.runs", range: "today", filter: { result: "fail" } }).total).toBe(1);
  });

  it("derives a ratio and compares with the period before", () => {
    const fail = core.stats.query({ stat: "commands.failrate", range: "7d" });
    expect(fail.total).toBeCloseTo(100 * (2 / 5));
    const runs = core.stats.query({ stat: "commands.runs", range: "today", compare: true });
    expect(runs.previous).toBeDefined();
    expect(runs.previous!.values).toHaveLength(24);
  });

  it("takes quantiles of a distribution", () => {
    const d = core.stats.query({ stat: "commands.duration", range: "7d" });
    expect(d.measure).toBe("p50");
    expect(d.quantiles!.p50).toBeGreaterThan(1000);
    expect(d.quantiles!.p90).toBeGreaterThan(d.quantiles!.p50);
    expect(core.stats.query({ stat: "commands.duration", range: "7d", measure: "sum" }).total).toBe(2000 + 4000 + 100 + 3000 + 5000);
  });

  it("counts agent time from turns, cut at hour edges", async () => {
    const doc = (startedAt: number, endedAt: number) => JSON.stringify({ agentKind: "claude", startedAt, endedAt, outcome: "done", auto: false, tools: [{ name: "Bash", count: 3, failed: 1 }], files: [{ path: "/src/app/a.ts", change: "M" }] });
    const ins = core.views.db.prepare(`INSERT INTO turns (agent_id, idx, started_at, cwd, doc) VALUES (?, ?, ?, ?, ?)`);
    ins.run("a1", 0, hour - DAY - 30 * 60_000, "/src/app", doc(hour - DAY - 30 * 60_000, hour - DAY + 30 * 60_000));
    ins.run("a1", 1, hour - DAY + 40 * 60_000, "/src/app", doc(hour - DAY + 40 * 60_000, hour - DAY + 50 * 60_000));
    core.stats.rebuild();
    await core.stats.idle();
    const t = core.stats.query({ stat: "agents.time", range: "7d", by: "agent" });
    expect(t.total).toBe(70 * 60_000);
    expect(t.series[0]!.label).toBe("Claude");
    expect(core.stats.query({ stat: "agents.tools", range: "7d", filter: { result: "fail" } }).total).toBe(2);
    expect(core.stats.query({ stat: "agents.waiting", range: "7d", measure: "sum" }).total).toBe(10 * 60_000);
  });

  it("keeps the hours of pruned events on a rebuild", async () => {
    core.data.store.delete({ before: hour - 2 * DAY, types: ["command"] });
    core.stats.rebuild("commands.runs");
    await core.stats.idle();
    expect(core.stats.query({ stat: "commands.runs", range: "7d" }).total).toBe(5);
  });

  it("records focus one span at a time, and none while cmd is away", () => {
    const spans = () => core.data.query({ types: ["user.focus"] }).map((e) => ({ win: (e.data as { windowId?: string }).windowId, open: e.until === null }));
    const ops = core.windowOps;
    ops.focused("wa", "x1");
    ops.focused("wb", "y1");
    ops.present("wa", true); // wa's app window has focus: wb's span ends
    expect(spans().filter((s) => s.open).map((s) => s.win)).toEqual(["x1"]);
    ops.present("wa", false);
    expect(spans().filter((s) => s.open)).toEqual([]);
    ops.focused("wa", "x2"); // selected while away: no span yet
    expect(spans().filter((s) => s.open)).toEqual([]);
    ops.present("wa", true);
    expect(spans().filter((s) => s.open).map((s) => s.win)).toEqual(["x2"]);
  });

  it("keeps samples of what has no events: memory read at start, stalls as they happen", () => {
    expect(core.stats.query({ stat: "core.memory", range: "today" }).total).toBeGreaterThan(1e6);
    core.stats.sample("core.stalls", ["startup: stats"], 150);
    core.stats.sample("core.stalls", ["startup: stats"], 400);
    const stalls = core.stats.query({ stat: "core.stalls", range: "today", by: "activity", top: 3 });
    expect(stalls.total).toBe(2);
    expect(stalls.ranking).toEqual([{ key: "startup: stats", label: "startup: stats", value: 2 }]);
    expect(core.stats.query({ stat: "core.stalls", range: "today", measure: "max" }).total).toBe(400);
  });

  it("forgets a project everywhere", async () => {
    core.data.forget({ projectId: "dir:/src/app" });
    await core.stats.idle();
    const r = core.stats.query({ stat: "commands.runs", range: "7d", by: "project" });
    expect(r.series.map((s) => s.label)).toEqual(["other"]);
  });
});
