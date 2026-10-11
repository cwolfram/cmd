// A day as the Journal draws it: a ribbon of what happened (agents in parallel take lanes,
// coloured by kind), hours under it; a click picks one.
import { useState } from "react";
import { Ribbon, type RibbonItem } from "./timeline.tsx";

const H = 3_600_000;
const DAY = Date.UTC(2026, 9, 10, 0, 0);
const at = (h: number) => DAY + h * H;
const ITEMS: RibbonItem[] = [
  { id: "a", start: at(9), end: at(10.5), hue: 210, label: "Session names · 09:00–10:30" },
  { id: "b", start: at(9.75), end: at(12), hue: 140, label: "Search in the palette · 09:45–12:00" },
  { id: "c", start: at(11), end: at(11.5), hue: 30, label: "Release v0.24.0 · 11:00–11:30" },
  { id: "d", start: at(13), end: at(16), hue: 210, label: "Window design · 13:00–16:00" },
  { id: "e", start: at(14), end: at(15.25), hue: 280, label: "Reviewing a branch · 14:00–15:15" },
  { id: "f", start: at(16.5), end: at(17), hue: 30, label: "Release v0.24.1 · 16:30–17:00" },
];
const TICKS = [9, 11, 13, 15, 17].map((h) => ({ at: at(h), label: `${h}:00` }));

/** A working day, two lanes where work overlapped; click a bar to pick it. */
export const Day = () => {
  const [picked, setPicked] = useState<string | null>("d");
  return (
    <div style={{ width: 640 }}>
      <Ribbon items={ITEMS} from={at(8.5)} to={at(17.5)} ticks={TICKS} picked={picked} onPick={(id) => setPicked(id === picked ? null : id)} />
    </div>
  );
};
