// Changing how the shown workspace is laid out, from commands and the board alike: its view
// mode (Toggle Focus returns to the last other one), its sidebars, a window's strip width.

import type { PaneId } from "@cmd/protocol";
import { getState, getWorkspaceView, setWorkspaceView } from "../../lib/store.ts";
import { boardOf } from "./board.ts";
import type { Docks } from "./docks.ts";
import type { ViewMode } from "./layouts.ts";
import { withWidth } from "./strip.ts";

const here = () => getState().workspaceId;

export function setMode(mode: ViewMode): void {
  setWorkspaceView(here(), "view.mode", mode);
  // The layout Toggle Focus returns to: the last mode other than focus, however focus was entered.
  if (mode !== "focus") setWorkspaceView(here(), "view.layoutMode", mode);
}

/** Change the sidebars (from what's live, so stale ids drop out). */
export function setDocks(f: (d: Docks) => Docks): void {
  setWorkspaceView(here(), "docks", f(boardOf(getState()).docks));
}

export function setStripWidth(id: PaneId, fraction: number): void {
  const widths = getWorkspaceView<Record<PaneId, number>>(here(), "strip.widths", {});
  setWorkspaceView(here(), "strip.widths", withWidth(widths, id, fraction, getState()));
}
