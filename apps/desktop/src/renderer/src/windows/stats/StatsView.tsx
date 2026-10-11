// The Stats widget's window view: asks the core for the page's stats in one call (stats.queryMany),
// scoped to the widget's workspace or all of them, and again when the core says one of them
// changed (stats.changed) and once a minute (time spent grows without events). A stat's detail
// is a second page in the same window, with Back.

import { useCallback, useEffect, useRef, useState } from "react";
import type { StatQuery, StatResult, StatsEvent } from "@cmd/protocol";
import { cmd } from "../../lib/bridge.ts";
import { scopeOf } from "../../lib/widgets.ts";
import type { WindowViewProps } from "../registry.ts";
import { StatDetail, Stats, type StatsData, type StatsRange } from "./Stats.tsx";

/** The overview's queries, by the names Stats reads. */
function pageQueries(range: StatsRange): [keyof StatsData, StatQuery][] {
  return [
    ["time", { stat: "agents.time", range, by: "agent", compare: true }],
    ["active", { stat: "you.active", range, compare: true }],
    ["turns", { stat: "agents.turns", range, by: "outcome", compare: true }],
    ["waiting", { stat: "agents.waiting", range, measure: "sum" }],
    ["runs", { stat: "commands.runs", range, by: "command", top: 8, compare: true }],
    ["fail", { stat: "commands.failrate", range, by: "command", top: 100, compare: true }],
    ["tokens", { stat: "agents.tokens", range, by: "model", filter: { token: ["in", "out"] }, compare: true }],
    ["projects", { stat: "agents.time", range, by: "project", top: 6 }],
    ["heat", range === "year" ? { stat: "you.active", range: "365d", grain: "day" } : range === "today" ? { stat: "you.active", range: "today" } : { stat: "you.active", range: "30d", grain: "hour" }],
    ["ai", { stat: "ai.calls", range, by: "purpose", top: 6 }],
    ["memory", { stat: "core.memory", range }],
    ["stalls", { stat: "core.stalls", range }],
    ["worst", { stat: "core.stalls", range, measure: "max" }],
    ["size", { stat: "data.size", range }],
  ];
}

const REFRESH_MS = 60_000;

export function StatsView({ win }: WindowViewProps) {
  const scope = scopeOf(win.state.scope);
  const workspaceId = scope === "all" ? undefined : win.workspaceId;
  const [range, setRange] = useState<StatsRange>("week");
  const [data, setData] = useState<StatsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ stat: string; by: string | null } | null>(null);
  const [detailResult, setDetailResult] = useState<StatResult | null>(null);
  const gen = useRef(0);

  const load = useCallback(async () => {
    const g = ++gen.current;
    try {
      if (detail) {
        const r = await cmd.call("stats.query", { stat: detail.stat, range, compare: true, ...(workspaceId ? { workspaceId } : {}), ...(detail.by ? { by: detail.by, top: 12 } : {}) });
        if (g === gen.current) setDetailResult(r);
        return;
      }
      const qs = pageQueries(range);
      const rs = await cmd.call("stats.queryMany", { queries: qs.map(([, q]) => ({ ...q, ...(workspaceId ? { workspaceId } : {}) })) });
      if (g !== gen.current) return;
      setData(Object.fromEntries(qs.map(([k], i) => [k, rs[i]])) as StatsData);
      setError(null);
    } catch (err) {
      if (g === gen.current) setError((err as Error).message);
    }
  }, [range, workspaceId, detail]);

  useEffect(() => {
    void load();
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = cmd.onEvent((e) => {
      if (e.type !== "stats.changed") return;
      const mine = detail ? [detail.stat] : pageQueries(range).map(([, q]) => q.stat);
      if (!(e as StatsEvent).stats.some((s) => mine.includes(s))) return;
      clearTimeout(t);
      t = setTimeout(() => void load(), 1500);
    });
    const every = setInterval(() => void load(), REFRESH_MS);
    return () => (off(), clearTimeout(t), clearInterval(every));
  }, [load]);

  if (detail) return <StatDetail result={detailResult} range={range} by={detail.by} onBy={(by) => (setDetailResult(null), setDetail({ ...detail, by }))} onRange={setRange} onBack={() => (setDetail(null), setDetailResult(null))} />;
  return <Stats range={range} data={data} error={error} onRange={(r) => (setRange(r), setData(null))} onOpen={(stat) => setDetail({ stat, by: null })} onRetry={() => void load()} />;
}
