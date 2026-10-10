// Text windows (renderer half): CodeMirror loads on first use; ⌘E to a preview where there is one, the file's menu, and the editor's commands (commands.ts).

import { cmd } from "../../lib/bridge.ts";
import { parentOf } from "../../lib/model.ts";
import { copy } from "../../lib/actions.ts";
import { lazyView, registerWindowView, stateStr } from "../registry.ts";
import { previewFor, togglePreview } from "../preview.ts";
import "./commands.ts";

registerWindowView({
  kind: "text",
  // CodeMirror loads on first use, not at startup.
  View: lazyView(() => import("./TextView.tsx").then((m) => m.TextView)),
  describe: (w) => ({ place: stateStr(w, "path") ? parentOf(stateStr(w, "path")!) : undefined }),
  menu: (w) => {
    const p = stateStr(w, "path");
    return p
      ? [
          ...(previewFor(p) ? [{ label: "Preview (⌘E)", run: () => togglePreview(w) }] : []),
          { label: "Open with Default App", run: () => cmd.openPath(p, { from: "user" }) },
          { label: "Copy Path", run: () => copy(p) },
        ]
      : [];
  },
});
