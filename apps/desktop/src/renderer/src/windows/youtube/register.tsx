// YouTube windows (renderer half): Change Video…, Fill Window and the video's link.

import { cmd } from "../../bridge.ts";
import { copy } from "../../actions.ts";
import { watchUrl, YouTubeView } from "./YouTubeView.tsx";
import { registerWindowView, stateStr } from "../registry.ts";

registerWindowView({
  kind: "youtube",
  View: YouTubeView,
  describe: () => ({ kind: null }),
  menu: (w) => {
    const url = watchUrl({ video: stateStr(w, "video"), list: stateStr(w, "list"), start: typeof w.state.start === "number" ? w.state.start : undefined });
    return url
      ? [
          { label: "Change Video…", run: () => void cmd.call("window.update", { id: w.id, title: "YouTube", state: { input: null } }).catch(() => {}) },
          { label: "Fill Window", checked: w.state.fill !== false, run: () => void cmd.call("window.update", { id: w.id, state: { fill: w.state.fill === false } }).catch(() => {}) },
          "-" as const,
          { label: "Open on YouTube", run: () => cmd.openPath(url, { from: "user" }) },
          { label: "Copy Link", run: () => copy(url) },
        ]
      : [];
  },
});
