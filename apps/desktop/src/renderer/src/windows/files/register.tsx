// File browser windows (renderer half): the folder it's in as the title's place, Show in Finder and Copy Path.

import { cmd } from "../../lib/bridge.ts";
import { parentOf } from "../../lib/model.ts";
import { copy } from "../../lib/actions.ts";
import { FilesView } from "./FilesView.tsx";
import { registerWindowView, stateStr } from "../registry.ts";

registerWindowView({
  kind: "files",
  View: FilesView,
  placeInToolbar: true,
  describe: (w) => ({ place: parentOf(stateStr(w, "path") ?? "/") }),
  menu: (w) => {
    const p = stateStr(w, "path");
    return p
      ? [
          { label: "Show in Finder", run: () => cmd.openPath(p, { from: "user" }) },
          { label: "Copy Path", run: () => copy(p) },
        ]
      : [];
  },
});
