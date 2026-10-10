// Live Diff (renderer half): the folder it follows, Choose Folder… and Show in Finder.

import { cmd } from "../../lib/bridge.ts";
import { shortPath } from "../../lib/model.ts";
import { LiveDiff } from "./LiveDiff.tsx";
import { registerWindowView, stateStr } from "../registry.ts";

registerWindowView({
  kind: "diff",
  View: LiveDiff,
  describe: (w) => ({ place: shortPath(stateStr(w, "path") ?? ""), kind: null }),
  menu: (w) => [
    {
      label: "Choose Folder…",
      run: () =>
        void cmd.chooseFolder().then((p) => {
          if (p) void cmd.call("window.update", { id: w.id, state: { path: p } }).catch(() => {});
        }),
    },
    { label: "Show in Finder", run: () => cmd.revealPath(stateStr(w, "path") ?? "") },
  ],
});
