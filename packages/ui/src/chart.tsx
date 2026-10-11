// Charts (docs/40-window-design.md, docs/49): the simple ones, drawn by the chart grammar in
// plot.tsx. Series take the --chart-N colours in order (the theme's terminal colours). Thin
// lines with a soft area, thin bars, a few grid lines and labels; a legend only for more than
// one series. Charts are as wide as their container and redraw on resize, so lines stay one
// pixel wherever they are. For stats over time, charts.tsx has the presets (TimeBars…).

import type { ReactNode } from "react";
import { Legend } from "./charts.tsx";
import { Bars, Line, Plot, seriesColor, useSize } from "./plot.tsx";

export interface Series {
  name: string;
  values: readonly number[];
}

export { Legend };

/**
 * A line, area or bar chart. `labels` name the x positions (the first and last
 * are shown); `format` writes the y axis' values; `height` in px.
 */
export function Chart({ kind = "area", series, labels, height = 140, format = String, max: fixedMax }: { kind?: "line" | "area" | "bar"; series: readonly Series[]; labels?: readonly ReactNode[]; height?: number; format?: (v: number) => string; max?: number }) {
  const n = Math.max(0, ...series.map((s) => s.values.length));
  const max = fixedMax ?? Math.max(0, ...series.flatMap((s) => s.values));
  const xLabel = labels?.length ? (i: number) => (i === 0 ? String(labels[0]) : i === n - 1 ? String(labels[labels.length - 1]) : "") : undefined;
  const ss = series.map((s) => ({ key: s.name, label: s.name, values: s.values }));
  return (
    <div className="ui-chart">
      {series.length > 1 && <Legend series={series} />}
      <Plot n={n} max={max} height={height} format={format} xLabel={xLabel} label={series.map((s) => s.name).join(", ")} cursor={kind !== "bar"}>
        {kind === "bar" ? <Bars series={ss} stack={false} /> : ss.map((s, i) => <Line key={s.key} values={s.values} color={seriesColor(i)} area={kind === "area"} />)}
      </Plot>
    </div>
  );
}

/** A small trend without axes, for a Stat or a table cell: missing values leave a gap; the last value gets a dot. */
export function Sparkline({ values, series = 0, height = 20, area = true, color }: { values: readonly (number | null)[]; series?: number; height?: number; area?: boolean; /** A role's colour instead of the series': "current" (the accent) or "neutral". */ color?: "current" | "neutral" }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const xs = values.filter((v): v is number => v !== null);
  // Tufte's sparkline: the shape of the data, its own min to max, no zero line.
  const max = xs.length ? Math.max(...xs) : 1;
  const min = xs.length ? Math.min(...xs) : 0;
  const w = size.w;
  const x = (i: number) => (values.length <= 1 ? w / 2 : 1 + (i / (values.length - 1)) * (w - 4));
  const y = (v: number) => 1.5 + (height - 3) * (1 - (v - min) / (max - min || 1));
  const runs: [number, number][][] = [[]];
  values.forEach((v, i) => (v === null ? runs.push([]) : runs[runs.length - 1]!.push([x(i), y(v)])));
  const paths = runs.filter((r) => r.length);
  const c = color ? `var(--chart-${color})` : seriesColor(series);
  const lastI = values.reduce<number>((a, v, i) => (v === null ? a : i), -1);
  return (
    <div ref={ref} className="ui-sparkline" style={{ height }}>
      {w > 0 && (
        <svg width={w} height={height} aria-hidden>
          {paths.map((r, k) => (
            <g key={k}>
              {area && r.length > 1 && <path d={`M${r[0]![0]},${height}L${r.map((p) => p.join(",")).join("L")}L${r[r.length - 1]![0]},${height}Z`} fill={c} className="ui-plot-area" />}
              <path d={`M${r.map((p) => p.join(",")).join("L")}`} stroke={c} className="ui-spark-line" />
            </g>
          ))}
          {lastI >= 0 && <circle cx={x(lastI)} cy={y(values[lastI]!)} r={1.75} fill={c} />}
        </svg>
      )}
    </div>
  );
}
