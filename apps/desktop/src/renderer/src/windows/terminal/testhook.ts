// Test hook for e2e/smoke.mjs: window.__cmdTermScreen(paneId) is what this window's
// terminal shows, its visible rows as text (pane.read is the core's copy, which a
// window that fell behind and resynced must match). Not installed in a packaged app.

import type { PaneId } from "@cmd/protocol";
import { terminals } from "./terminals.ts";

if (!location.href.includes("/app.asar/"))
  (window as unknown as { __cmdTermScreen?: (id: PaneId) => string }).__cmdTermScreen = (id) => {
    const { term } = terminals.get(id);
    const b = term.buffer.active;
    const rows: string[] = [];
    for (let y = b.viewportY; y < b.viewportY + term.rows; y++) rows.push(b.getLine(y)?.translateToString(true) ?? "");
    return rows.join("\n");
  };
