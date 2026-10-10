// The "visualizer" view: MilkDrop presets moving to a source of sound
// (windows/visualizer/VisualizerView.tsx). The title bar's menu names the source.

import { sourceLabel, VisualizerView, visualizerMenu } from "./VisualizerView.tsx";
import { registerWindowView } from "../registry.ts";

registerWindowView({
  kind: "visualizer",
  View: VisualizerView,
  describe: () => ({ kind: null }),
  titleMenu: (w) => ({ label: sourceLabel(typeof w.state.source === "string" ? w.state.source : "none"), entries: visualizerMenu(w) }),
  menu: visualizerMenu,
});
