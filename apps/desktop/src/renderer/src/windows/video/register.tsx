// Video window type (renderer half): the view loads on first use; the menu has the file's actions.

import { cmd } from "../../lib/bridge.ts";
import { copy } from "../../lib/actions.ts";
import { shortPath } from "../../lib/model.ts";
import { lazyView, registerWindowView, stateStr } from "../registry.ts";

const dirOf = (p: string) => p.split("/").slice(0, -1).join("/") || "/";

registerWindowView({
  kind: "video",
  View: lazyView(() => import("./VideoView.tsx").then((m) => m.VideoView)),
  describe: (w) => ({ place: shortPath(dirOf(stateStr(w, "path") ?? "")) }),
  menu: (w) => {
    const p = stateStr(w, "path");
    return p
      ? [
          { label: "Copy Path", run: () => copy(p) },
          { label: "Open with Default App", run: () => cmd.openPath(p, { from: "user" }) },
          { label: "Show in Finder", run: () => cmd.revealPath(p) },
        ]
      : [];
  },
});
