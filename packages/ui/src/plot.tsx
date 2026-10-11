// The chart grammar (docs/49 "Charts"): a Plot owns the scales, the axes, the plot area and the
// cursor; marks (Bars, Line, Area, Rule, Ticks) draw into it from its context, so a chart is a
// composition and the presets in charts.tsx are a few lines each. The look: hairline grid, the
// y axis on the trailing edge in mono tabular numbers, square dense marks, one accent for the
// bucket that matters. Scrubbing moves a rule and tells the header (onHover); arrow keys do
// the same, announced through a live region. Plots in one PlotGroup share the cursor.

import { area as d3area, curveMonotoneX, line as d3line } from "d3-shape";
import { scaleLinear } from "d3-scale";
import { createContext, useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

/** A series as the kit draws it: a key, a label, a value per bucket (null: no data there). */
export interface ChartSeries {
  key: string;
  label: string;
  values: readonly (number | null)[];
}

/** A series' colour: --chart-N in order, or a role's token. */
export const seriesColor = (i: number) => `var(--chart-${(i % 6) + 1})`;

/** What marks read from their Plot. */
export interface PlotScales {
  width: number;
  height: number;
  /** The plot area, in px from the svg's origin. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Buckets (bands) along x. */
  n: number;
  band: number;
  /** A band's left edge and centre. */
  x(i: number): number;
  cx(i: number): number;
  y(v: number): number;
  /** The top of the y axis (nice). */
  max: number;
  hover: number | null;
  current: number | null;
}

/** A line's stroke in px, the same at every size (plots and sparklines); its dot is twice that across. */
export const LINE_WIDTH = 2;

/** A dash pattern for a round-capped stroke `w` wide: dashes and gaps look `len` long once the caps are added. */
export const roundDashes = (w: number, len: number): string => `${Math.max(0.01, len - w)} ${len + w}`;

const PlotContext = createContext<PlotScales | null>(null);

/** The scales of the Plot a mark is in. */
export function usePlot(): PlotScales {
  const p = useContext(PlotContext);
  if (!p) throw new Error("A chart mark must be inside a Plot");
  return p;
}

const GroupContext = createContext<{ hover: number | null; setHover(i: number | null): void } | null>(null);

/** Plots inside share one cursor: scrubbing one week scrubs every chart of that week. */
export function PlotGroup({ children }: { children: ReactNode }) {
  const [hover, setHover] = useState<number | null>(null);
  const value = useMemo(() => ({ hover, setHover }), [hover]);
  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>;
}

/** An element's size, kept current (charts draw at device pixels, not scaled). */
export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    const ro = new ResizeObserver(read);
    ro.observe(el);
    read();
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DURATION_STEPS = [SECOND, 5 * SECOND, 15 * SECOND, 30 * SECOND, MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, 24 * HOUR, 48 * HOUR, 7 * 24 * HOUR];

/** The y axis' ticks for data up to `max`: 0 and one or two round steps above it; "duration" steps in time units (15m, 1h, 6h). */
export function axisTicks(max: number, kind: "number" | "duration" = "number"): number[] {
  if (!(max > 0)) return [0];
  if (kind === "duration") {
    const step = DURATION_STEPS.find((s) => max / s <= 2) ?? Math.ceil(max / 2 / (24 * HOUR)) * 24 * HOUR;
    const n = Math.max(1, Math.ceil(max / step - 1e-9));
    return Array.from({ length: n + 1 }, (_, i) => i * step);
  }
  const s = scaleLinear().domain([0, max]).nice(2);
  return s.ticks(2);
}

/** Mono 10px digits are ~6px wide: how wide the axis column is for these labels. */
const axisWidth = (labels: string[]) => Math.ceil(Math.max(1, ...labels.map((l) => l.length)) * 6.1) + 8;

export interface PlotProps {
  /** How many buckets along x. */
  n: number;
  /** The largest value the marks draw (the axis rounds it up). */
  max: number;
  /** In px, or "fill" to take the height its container gives it. */
  height?: number | "fill";
  /** The y axis' labels. */
  format?: (v: number) => string;
  /** Round steps for counts, or in time units for durations. */
  ticks?: "number" | "duration";
  /** No y axis (sparklines, small multiples). */
  bare?: boolean;
  /** The x axis' label for a bucket; labels thin out to fit. */
  xLabel?: (i: number) => string;
  /** The bucket that matters (today): marks draw it in the accent. */
  current?: number | null;
  /** The chart's accessible name: what it shows, in words. */
  label: string;
  /** A bucket in words, for the live region while the cursor is on it. */
  describe?: (i: number) => string;
  /** The cursor moved to a bucket, or left (null). */
  onHover?: (i: number | null) => void;
  /** A bucket was clicked or chosen with Enter. */
  onSelect?: (i: number) => void;
  /** Draw a vertical rule at the cursor (lines); bars mark themselves. */
  cursor?: boolean;
  children: ReactNode;
}

/** A chart: scales, a hairline grid, the axes, the cursor, and the marks inside it. */
export function Plot({ n, max, height = 120, format = String, ticks: tickKind = "number", bare = false, xLabel, current = null, label, describe, onHover, onSelect, cursor = false, children }: PlotProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const group = useContext(GroupContext);
  const [own, setOwn] = useState<number | null>(null);
  const hover = group ? group.hover : own;
  const setHover = useCallback(
    (i: number | null) => {
      if (group) group.setHover(i);
      else setOwn(i);
      onHover?.(i);
    },
    [group, onHover],
  );
  const live = useId();
  const w = size.w;
  const h = height === "fill" ? size.h : height;
  const ticks = bare ? [] : axisTicks(max, tickKind);
  const top = bare ? Math.max(max, 1e-9) : ticks[ticks.length - 1] || 1;
  const labels = ticks.map(format);
  const pad = { l: 0, r: bare ? 0 : axisWidth(labels), t: bare ? 1 : 6, b: xLabel ? 18 : bare ? 0 : 2 };
  const iw = Math.max(0, w - pad.l - pad.r);
  const ih = Math.max(0, h - pad.t - pad.b);
  const band = n ? iw / n : iw;
  const scales: PlotScales = {
    width: w,
    height: h,
    left: pad.l,
    right: pad.l + iw,
    top: pad.t,
    bottom: pad.t + ih,
    n,
    band,
    x: (i) => pad.l + i * band,
    cx: (i) => pad.l + (i + 0.5) * band,
    y: (v) => pad.t + ih - (Math.max(0, v) / top) * ih,
    max: top,
    hover,
    current,
  };
  const at = (e: MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - pad.l) / (band || 1));
    return i >= 0 && i < n ? i : null;
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!n) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const d = e.key === "ArrowRight" ? 1 : -1;
      setHover(Math.max(0, Math.min(n - 1, (hover ?? (d > 0 ? -1 : n)) + d)));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setHover(e.key === "Home" ? 0 : n - 1);
    } else if (e.key === "Enter" && hover !== null) onSelect?.(hover);
    else if (e.key === "Escape") setHover(null);
  };
  // x labels: from the last one back, each that has text and doesn't touch the one after it.
  // With labels on every bucket that thins them evenly; labels only where a month starts stay so.
  const xs: number[] = [];
  if (xLabel && n && band > 0) {
    const text = Array.from({ length: n }, (_, i) => xLabel(i));
    const widest = Math.max(...text.map((t) => t.length)) * 6 + 10;
    const every = Math.max(1, Math.ceil(widest / band));
    const even = text.every((t) => t);
    for (let i = n - 1, next = Infinity; i >= 0; i--) {
      if (!text[i] || (even ? (n - 1 - i) % every : (next - i) * band < widest)) continue;
      xs.push(i);
      next = i;
    }
  }
  return (
    <div ref={ref} className="ui-plot" data-fill={height === "fill" || undefined} style={height === "fill" ? undefined : { height }} tabIndex={bare ? undefined : 0} onKeyDown={bare ? undefined : key} onBlur={() => !bare && setHover(null)} aria-describedby={describe ? live : undefined}>
      {w > 0 && h > 0 && (
        <PlotContext.Provider value={scales}>
          <svg width={w} height={h} role="img" aria-label={label} data-hover={hover !== null || undefined} onPointerMove={bare ? undefined : (e) => setHover(at(e))} onPointerLeave={bare ? undefined : () => setHover(null)} onClick={onSelect ? (e) => { const i = at(e); if (i !== null) onSelect(i); } : undefined} style={onSelect ? { cursor: "pointer" } : undefined}>
            {ticks.map((t, i) => (
              <g key={t}>
                <line className={i === 0 ? "ui-plot-base" : "ui-plot-grid"} x1={pad.l} x2={pad.l + iw} y1={Math.round(scales.y(t)) + 0.5} y2={Math.round(scales.y(t)) + 0.5} />
                <text className="ui-plot-tick" x={w} y={scales.y(t)} textAnchor="end" dominantBaseline="middle">
                  {labels[i]}
                </text>
              </g>
            ))}
            {/* The cursor under the marks: the dots sit on it, their ring a gap around them. */}
            {cursor && hover !== null && <line className="ui-plot-cursor" x1={Math.round(scales.cx(hover)) + 0.5} x2={Math.round(scales.cx(hover)) + 0.5} y1={pad.t} y2={pad.t + ih} />}
            {children}
            {xs.map((i) => (
              <text key={i} className="ui-plot-tick" data-on={i === hover || i === current || undefined} x={Math.min(Math.max(scales.cx(i), pad.l + 8), pad.l + iw - 8)} y={h - 4} textAnchor="middle">
                {xLabel!(i)}
              </text>
            ))}
          </svg>
        </PlotContext.Provider>
      )}
      {describe && (
        <span id={live} className="ui-plot-live" aria-live="polite">
          {hover !== null ? describe(hover) : ""}
        </span>
      )}
    </div>
  );
}

/** Bars per bucket: one series in neutral with the current bucket in the accent, several stacked in --chart-N. Empty buckets show a hairline tick, missing ones nothing. */
export function Bars({ series, stack = true }: { series: readonly ChartSeries[]; stack?: boolean }) {
  const p = usePlot();
  const one = series.length === 1;
  const bw = Math.max(2, Math.min(28, Math.floor(p.band * (one || stack ? 0.62 : 0.8))));
  const out: ReactNode[] = [];
  for (let i = 0; i < p.n; i++) {
    const x0 = Math.round(p.x(i) + (p.band - (one || stack ? bw : bw)) / 2);
    const vals = series.map((s) => s.values[i] ?? null);
    if (vals.every((v) => v === null)) continue;
    const total = vals.reduce<number>((a, v) => a + (v ?? 0), 0);
    const state = i === p.hover ? "hover" : undefined;
    if (!total) {
      out.push(<rect key={i} className="ui-plot-empty" x={x0} y={p.bottom - 1} width={bw} height={1} />);
      continue;
    }
    if (one || stack) {
      let base = 0;
      vals.forEach((v, k) => {
        if (!v) return;
        const y1 = p.y(base + v);
        const y0 = p.y(base);
        base += v;
        out.push(<rect key={`${i}-${k}`} className="ui-plot-bar" data-state={state} data-current={(one && i === p.current) || undefined} x={x0} y={y1} width={bw} height={Math.max(1, y0 - y1)} style={one ? undefined : { fill: seriesColor(k) }} />);
      });
    } else {
      const w = Math.max(1, Math.floor(bw / series.length) - 1);
      vals.forEach((v, k) => v && out.push(<rect key={`${i}-${k}`} className="ui-plot-bar" data-state={state} x={x0 + k * (w + 1)} y={p.y(v)} width={w} height={Math.max(1, p.bottom - p.y(v))} style={{ fill: seriesColor(k) }} />));
    }
  }
  return <g className="ui-plot-bars">{out}</g>;
}

/** A line through the buckets' centres (gaps where a value is missing); `area` fills under it. Its stroke is 2 px at every size; `weight` scales it, its dashes and dots (a comparison line under the main one: 0.66). */
export function Line({ values, color = seriesColor(0), dashed = false, area = false, weight = 1 }: { values: readonly (number | null)[]; color?: string; dashed?: boolean; area?: boolean; weight?: number }) {
  const p = usePlot();
  const width = LINE_WIDTH * weight;
  const defined = (v: number | null) => v !== null && Number.isFinite(v);
  const pts = values.map((v, i) => [i, v] as const);
  const line = d3line<readonly [number, number | null]>()
    .defined(([, v]) => defined(v))
    .x(([i]) => p.cx(i))
    .y(([, v]) => p.y(v ?? 0))
    .curve(curveMonotoneX)(pts);
  const fill = area
    ? d3area<readonly [number, number | null]>()
        .defined(([, v]) => defined(v))
        .x(([i]) => p.cx(i))
        .y0(p.bottom)
        .y1(([, v]) => p.y(v ?? 0))
        .curve(curveMonotoneX)(pts)
    : null;
  const last = [...pts].reverse().find(([, v]) => defined(v));
  const hv = p.hover !== null ? values[p.hover] : null;
  return (
    <g className="ui-plot-line" data-dashed={dashed || undefined}>
      {fill && <path className="ui-plot-area" d={fill} fill={color} />}
      {line && <path d={line} stroke={color} strokeWidth={width} fill="none" strokeDasharray={dashed ? roundDashes(width, 2 * width + 1) : undefined} />}
      {!dashed && last && p.hover === null && <circle className="ui-plot-dot" cx={p.cx(last[0])} cy={p.y(last[1]!)} r={2 * width} fill={color} />}
      {!dashed && p.hover !== null && hv !== null && hv !== undefined && <circle className="ui-plot-dot" cx={p.cx(p.hover)} cy={p.y(hv)} r={2.5 * width} fill={color} />}
    </g>
  );
}

/** A horizontal reference line across the plot (an average, a target), its label over its left end. */
export function Rule({ y, label, dashed = true }: { y: number; label?: string; dashed?: boolean }) {
  const p = usePlot();
  if (!(y > 0) || y > p.max) return null;
  const yy = Math.round(p.y(y)) + 0.5;
  return (
    <g className="ui-plot-rule">
      <line x1={p.left} x2={p.right} y1={yy} y2={yy} strokeDasharray={dashed ? roundDashes(1, 2.5) : undefined} />
      {label && (
        <text className="ui-plot-tick ui-plot-rule-label" x={p.left + 2} y={yy - 4}>
          {label}
        </text>
      )}
    </g>
  );
}

/** A short tick per bucket at another value (the period before): Few's comparative measure. */
export function Ticks({ values }: { values: readonly (number | null)[] }) {
  const p = usePlot();
  const w = Math.max(4, Math.min(32, Math.floor(p.band * 0.62) + 4));
  return (
    <g className="ui-plot-ticks">
      {values.map((v, i) => (v ? <line key={i} x1={Math.round(p.cx(i) - w / 2)} x2={Math.round(p.cx(i) + w / 2)} y1={Math.round(p.y(v)) + 0.5} y2={Math.round(p.y(v)) + 0.5} /> : null))}
    </g>
  );
}
