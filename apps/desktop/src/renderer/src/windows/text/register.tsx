// Text windows (renderer half): CodeMirror loads on first use; ⌘E to a preview where there is one, and the file's menu.

import { cmd } from "../../bridge.ts";
import { parentOf } from "../../model.ts";
import { copy } from "../../actions.ts";
import { lazyView, registerWindowView, stateStr } from "../registry.ts";
import { previewFor, togglePreview } from "../preview.ts";

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
