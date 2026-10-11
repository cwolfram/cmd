// `cmd stats …` (docs/49): the numbers the Stats widget shows, in the terminal's own idiom:
// one line per stat with its total, the change against the period before and a block
// sparkline; a stat on its own as bars per bucket and a ranking. --json for the data.

import { blockBar, formatDelta, formatValue, sparkline, type StatQuery, type StatRange, type StatResult } from "@cmd/protocol";
import type { Connection } from "@cmd/protocol/node";

type Client = Connection["client"];

export const STATS_HELP = `  stats [--range today|week|month|year|24h|7d|30d|365d] [--workspace ID] [--json]
                                      how cmd was used: agent time, your time, turns, commands, failures, tokens, commits
  stats ls                            every stat: what it measures and how it can be split
  stats ID [--range R] [--by DIM] [--top N] [--grain hour|day|week|month] [--measure n|sum|mean|max|p50|p90] [--project PATH] [--json]
                                      one stat per bucket, split by a dimension or ranked
  stats rebuild [ID]                  count a stat (or all) again from the event log`;

/** The overview: what the Stats widget leads with. */
export const OVERVIEW: Omit<StatQuery, "range">[] = [
  { stat: "agents.time" },
  { stat: "you.active" },
  { stat: "agents.turns" },
  { stat: "agents.waiting" },
  { stat: "commands.runs" },
  { stat: "commands.failrate" },
  { stat: "agents.tokens", filter: { token: ["in", "out"] } },
  { stat: "git.commits" },
  { stat: "ai.calls" },
];

const RANGES = ["today", "week", "month", "year", "24h", "7d", "30d", "365d"];

function rangeOf(v: unknown): StatRange {
  if (v === undefined) return "7d";
  if (typeof v === "string" && RANGES.includes(v)) return v as StatRange;
  throw new Error(`--range takes ${RANGES.join(", ")}: not "${String(v)}"`);
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

function line(r: StatResult, width: number): string {
  const unit = r.stat.unit;
  const delta = r.previous ? formatDelta(r.total, r.previous.total, unit) : "";
  return `${r.stat.title.padEnd(width)}  ${formatValue(r.total, unit).padStart(9)}  ${delta.padStart(7)}  ${sparkline(r.series[0]?.values ?? [])}`;
}

export async function statsCommand(client: Client, pos: string[], opt: Record<string, unknown>): Promise<number> {
  const [sub, id] = pos;
  const json = !!opt.json;
  const range = rangeOf(opt.range);
  const workspaceId = str(opt.workspace);
  if (!sub) {
    const rs = await client.call("stats.queryMany", { queries: OVERVIEW.map((q) => ({ ...q, range, compare: true, ...(workspaceId ? { workspaceId } : {}) })) });
    if (json) return console.log(JSON.stringify(rs, null, 2)), 0;
    const width = Math.max(...rs.map((r) => r.stat.title.length));
    for (const r of rs) console.log(line(r, width));
    const partial = rs.find((r) => r.partial)?.partial;
    if (partial) console.log(`\nCounting since ${new Date(partial.since).toLocaleDateString()}.`);
    return 0;
  }
  if (sub === "ls") {
    const all = await client.call("stats.catalog", {});
    if (json) return console.log(JSON.stringify(all, null, 2)), 0;
    const width = Math.max(...all.map((s) => s.id.length));
    for (const s of all) console.log(`${s.id.padEnd(width)}  ${s.description}${s.dims.length ? `  [${s.dims.map((d) => d.id).join(", ")}]` : ""}${s.available ? "" : "  (not recorded: Settings → Data)"}`);
    return 0;
  }
  if (sub === "rebuild") {
    const r = await client.call("stats.rebuild", id ? { stat: id } : {});
    console.log(`Counting again: ${r.stats.join(", ")}`);
    return 0;
  }
  const by = str(opt.by);
  const top = str(opt.top) ? Math.max(1, Number(opt.top)) : by ? 10 : undefined;
  const project = str(opt.project);
  const q: StatQuery = { stat: sub, range, compare: true, ...(by ? { by } : {}), ...(top ? { top } : {}), ...(workspaceId ? { workspaceId } : {}) };
  if (str(opt.grain)) q.grain = str(opt.grain) as StatQuery["grain"];
  if (str(opt.measure)) q.measure = str(opt.measure) as StatQuery["measure"];
  if (project) q.filter = { project: `dir:${project.replace(/^~/, process.env.HOME ?? "~")}` };
  const r = await client.call("stats.query", q);
  if (json) return console.log(JSON.stringify(r, null, 2)), 0;
  const unit = r.stat.unit;
  console.log(`${r.stat.title}: ${formatValue(r.total, unit)}${r.previous ? `  ${formatDelta(r.total, r.previous.total, unit)} on the period before` : ""}${r.quantiles ? `  (median ${formatValue(r.quantiles.p50, unit)}, 90% under ${formatValue(r.quantiles.p90, unit)})` : ""}`);
  const fmt = new Intl.DateTimeFormat(undefined, r.grain === "hour" ? { hour: "2-digit", minute: "2-digit" } : r.grain === "month" ? { month: "short", year: "numeric" } : { weekday: "short", day: "numeric", month: "short" });
  const totals = r.buckets.map((_, i) => r.series.reduce((s, x) => s + (x.values[i] ?? 0), 0));
  const max = Math.max(0, ...totals);
  console.log();
  r.buckets.forEach((b, i) => {
    if (r.series.every((s) => s.values[i] === null)) return;
    console.log(`  ${fmt.format(b).padEnd(14)} ${formatValue(totals[i]!, unit, true).padStart(7)}  ${blockBar(max ? totals[i]! / max : 0, 30)}`);
  });
  if (r.ranking?.length) {
    const rmax = Math.max(...r.ranking.map((x) => x.value));
    const width = Math.min(32, Math.max(...r.ranking.map((x) => x.label.length)));
    console.log();
    for (const x of r.ranking) console.log(`  ${x.label.slice(0, width).padEnd(width)} ${formatValue(x.value, unit, true).padStart(7)}  ${blockBar(x.value / rmax, 24)}`);
  } else if (r.series.length > 1) {
    console.log();
    for (const s of r.series) console.log(`  ${s.label.padEnd(16)} ${formatValue(s.total, unit).padStart(9)}  ${sparkline(s.values)}`);
  }
  if (r.partial) console.log(`\nCounting since ${new Date(r.partial.since).toLocaleDateString()}.`);
  return 0;
}
