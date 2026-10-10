// Browser windows (renderer half): the title (the page's, else its host) and right-click's Device Size, Open in Default Browser and Copy URL.

import type { AppWindow } from "@cmd/protocol";
import { cmd } from "../../bridge.ts";
import type { MenuEntry } from "../../context.ts";
import { copy } from "../../actions.ts";
import { hostOf } from "../../model.ts";
import { BrowserView } from "./BrowserView.tsx";
import { DEVICES } from "./devices.ts";
import { registerWindowView, stateStr } from "../registry.ts";

/** Right-click → Device Size: show the page at a phone's, tablet's or desktop's size. */
function deviceMenu(w: AppWindow): MenuEntry {
  const current = stateStr(w, "device");
  const pick = (device: string | null) => () => void cmd.call("window.update", { id: w.id, state: { device } }).catch(() => {});
  return {
    label: "Device Size",
    submenu: [
      { label: "Fit Window", checked: !current, run: pick(null) },
      ...DEVICES.flatMap((group): MenuEntry[] => [
        "-",
        ...group.map((d) => ({ label: `${d.name}  ${d.width}×${d.height}`, checked: current === d.id, run: pick(d.id) })),
      ]),
    ],
  };
}

registerWindowView({
  kind: "browser",
  View: BrowserView,
  placeInToolbar: true,
  describe: (w) => {
    const url = stateStr(w, "url") ?? null;
    const host = hostOf(url).replace(/^www\./, "");
    return { name: (w.title && w.title !== url ? w.title : host) || "New Tab", place: host };
  },
  menu: (w) => {
    const url = stateStr(w, "url");
    return [
      deviceMenu(w),
      ...(url
        ? [
            "-" as const,
            { label: "Open in Default Browser", run: () => cmd.openPath(url, { from: "user" }) },
            { label: "Copy URL", run: () => copy(url) },
          ]
        : []),
    ];
  },
});
