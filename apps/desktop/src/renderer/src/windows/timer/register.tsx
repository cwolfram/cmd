// Timer widgets (renderer half): Start or Pause, and Reset; the core rings them.

import { TimerView } from "./TimerView.tsx";
import { setWidgetState } from "../../lib/widgets.ts";
import { registerWindowView } from "../registry.ts";

registerWindowView({
  kind: "timer",
  View: TimerView,
  describe: () => ({ kind: null }),
  menu: (w) => [
    { label: w.state.endsAt ? "Pause" : "Start", run: () => setWidgetState(w.id, { action: w.state.endsAt ? "pause" : "start" }) },
    { label: "Reset", run: () => setWidgetState(w.id, { action: "reset" }) },
  ],
});
