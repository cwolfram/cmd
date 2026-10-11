// Charts as a dashboard holds them: stats with sparklines, an area chart of two series (it
// draws their legend), and a bar chart, each in a Pane that names its unit (the Resources widget).
import { Chart, Legend, Sparkline } from "./chart.tsx";
import { Pane, Panes, Stat, Tiles, View } from "./frame.tsx";

const WAVE = Array.from({ length: 40 }, (_, i) => 20 + 12 * Math.sin(i / 4) + (i % 7));
const TWO = [
  { name: "CPU", values: WAVE },
  { name: "GPU", values: WAVE.map((v) => v * 0.6) },
];

/** Stats over sparklines, then the charts; two columns from 720px. The axis sits on the right, under the unit. */
export const Dashboard = () => (
  <div style={{ width: 760, height: 360, display: "flex" }}>
    <View inset>
      <Panes>
        <Pane wide>
          <Tiles min={120} gap={4}>
            <Stat label="CPU" value="24.1" unit="%" delta="▲ 4%" deltaTone="warning">
              <Sparkline values={WAVE} />
            </Stat>
            <Stat label="Memory" value="6.6" unit="GB">
              <Sparkline values={WAVE.map((v) => 60 - v)} series={1} />
            </Stat>
            <Stat label="Network" value="12.1" unit="MB/s">
              <Sparkline values={WAVE.map((v, i) => v + (i % 5))} series={3} />
            </Stat>
          </Tiles>
        </Pane>
        <Pane title="CPU and GPU" aside="%">
          <Chart series={TWO} labels={["40m", "now"]} height={110} />
        </Pane>
        <Pane title="Network" aside="MB/s">
          <Chart kind="bar" series={[{ name: "Network", values: WAVE.slice(0, 20) }]} labels={["20m", "now"]} height={110} />
        </Pane>
      </Panes>
    </View>
  </div>
);

/** Each kind with the same series: area (the default), line, bar. */
export const Kinds = () => (
  <div style={{ display: "flex", gap: 24, width: 760 }}>
    {(["area", "line", "bar"] as const).map((kind) => (
      <div key={kind} style={{ flex: 1 }}>
        <Chart kind={kind} series={TWO} labels={["40m", "now"]} height={110} />
      </div>
    ))}
  </div>
);

/** The legend alone, for series drawn some other way (sparklines side by side). */
export const LegendAlone = () => <Legend series={[...TWO, { name: "Network", values: [] }]} />;
