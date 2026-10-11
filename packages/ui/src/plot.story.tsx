// The chart grammar on its own (docs/49): a Plot with marks composed by hand, for a chart no
// preset draws. Bars with the period before as Ticks and an average Rule; a Line over Bars;
// ChartHead showing what's under the cursor.
import { useState } from "react";
import { ChartHead } from "./charts.tsx";
import { Bars, Line, Plot, Rule, Ticks } from "./plot.tsx";

const noise = (i: number) => Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
const runs = Array.from({ length: 14 }, (_, i) => Math.round(20 + 60 * noise(i)));
const failed = runs.map((v, i) => Math.round(v * 0.15 * noise(i + 3)));
const before = runs.map((v, i) => Math.round(v * (0.7 + 0.5 * noise(i + 9))));
const days = ["M", "T", "W", "T", "F", "S", "S"];

/** Bars, the period before as ticks, the mean as a rule; the header shows the day under the cursor. */
export const Composed = () => {
  const [hover, setHover] = useState<number | null>(null);
  const mean = runs.reduce((a, v) => a + v, 0) / runs.length;
  return (
    <div style={{ width: 520, padding: 16, display: "flex", flexDirection: "column", gap: 6 }}>
      <ChartHead summary="Commands, two weeks" readout={hover !== null ? <><b className="ui-chart-value">{runs[hover]}</b> day {hover + 1}, {before[hover]} the week before</> : undefined} />
      <Plot n={runs.length} max={Math.max(...runs, ...before)} height={130} xLabel={(i) => days[i % 7]!} current={runs.length - 1} label="Commands per day" onHover={setHover}>
        <Bars series={[{ key: "runs", label: "Runs", values: runs }]} />
        <Ticks values={before} />
        <Rule y={mean} label="avg" />
      </Plot>
    </div>
  );
};

/** A line of failures over the runs' bars, with the cursor's rule: two marks in one plot. */
export const Overlay = () => (
  <div style={{ width: 520, padding: 16 }}>
    <Plot n={runs.length} max={Math.max(...runs)} height={130} xLabel={(i) => String(i + 1)} label="Runs and failures per day" cursor>
      <Bars series={[{ key: "runs", label: "Runs", values: runs }]} />
      <Line values={failed} color="var(--danger)" />
    </Plot>
  </div>
);
