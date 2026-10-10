// PDF windows (renderer half): pdf.js loads on first use; Dark Pages and the file's menu.

import { cmd } from "../../bridge.ts";
import { parentOf } from "../../model.ts";
import { copy } from "../../actions.ts";
import { lazyView, registerWindowView, stateStr } from "../registry.ts";

registerWindowView({
  kind: "pdf",
  // pdf.js loads on first use, not at startup.
  View: lazyView(() => import("./PdfView.tsx").then((m) => m.PdfView)),
  describe: (w) => ({ place: stateStr(w, "path") ? parentOf(stateStr(w, "path")!) : undefined }),
  menu: (w) => {
    const p = stateStr(w, "path");
    return [
      { label: "Dark Pages", checked: w.state.dark === true, run: () => void cmd.call("window.update", { id: w.id, state: { dark: w.state.dark !== true } }).catch(() => {}) },
      "-" as const,
      ...(p
        ? [
            { label: "Open with Default App", run: () => cmd.openPath(p, { from: "user" }) },
            { label: "Show in Finder", run: () => cmd.revealPath(p) },
            { label: "Copy Path", run: () => copy(p) },
          ]
        : []),
    ];
  },
});
