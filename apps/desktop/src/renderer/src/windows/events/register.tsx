// Event Stream (renderer half): pause, clear, and which classes of events show.

import type { AppWindow } from "@cmd/protocol";
import type { MenuEntry } from "../../lib/context.ts";
import { clearEventStream, eventClasses, EventsView } from "./EventsView.tsx";
import { setWidgetState } from "../../lib/widgets.ts";
import { registerWindowView } from "../registry.ts";

// Event Stream: pause, clear, and which classes of events show (the core's classes, data.explain).
const eventsMenu = (w: AppWindow): MenuEntry[] => {
  const hidden = Array.isArray(w.state.hidden) ? (w.state.hidden as string[]) : [];
  const paused = w.state.paused === true;
  return [
    { label: paused ? "Resume" : "Pause", run: () => setWidgetState(w.id, { paused: !paused }) },
    { label: "Clear", run: () => clearEventStream(w.id) },
    "-",
    ...eventClasses().map(({ class: c, title }) => ({
      label: title,
      checked: !hidden.includes(c),
      run: () => setWidgetState(w.id, { hidden: hidden.includes(c) ? hidden.filter((x) => x !== c) : [...hidden, c] }),
    })),
    { label: "Show All", enabled: hidden.length > 0, run: () => setWidgetState(w.id, { hidden: [] }) },
  ];
};

registerWindowView({
  kind: "events",
  View: EventsView,
  describe: () => ({ kind: null }),
  titleMenu: (w) => {
    const hidden = Array.isArray(w.state.hidden) ? w.state.hidden.length : 0;
    return { label: hidden ? `${hidden} hidden` : "All Events", entries: eventsMenu(w) };
  },
  menu: eventsMenu,
});
