// Closed windows come back where they were (⇧⌘T, the Navigator's Recent): the board remembers
// each one's place as it goes (reopen.ts has the pure part), and reopening puts it back there
// before the core sends it, so it shows in its place from its first frame.

import { useEffect, useRef } from "react";
import type { WindowId, WorkspaceId } from "@cmd/protocol";
import { toast } from "@cmd/ui";
import { cmd } from "../lib/bridge.ts";
import { select } from "../lib/selection.ts";
import { getState, getWorkspaceView, setWorkspaceView } from "../lib/store.ts";
import type { Board } from "./board/board.ts";
import { boardOf } from "./board/board.ts";
import { readDocks } from "./board/docks.ts";
import { putBack, rememberPlaces, type Layout, type Place } from "./reopen.ts";

const layoutOf = (b: Board): Layout => ({ order: b.boardOrder, docks: readDocks(b.storedDocks), widths: b.stripWidths, rects: b.canvasRects });

/** Reopen a closed window (id: that one, else this workspace's newest), back in its place. */
export function reopenClosed(id?: WindowId): void {
  const st = getState();
  const here = st.workspaceId;
  const rec = id ? st.closed.find((c) => c.id === id) : st.closed.find((c) => c.workspaceId === here);
  if (!rec) return;
  const places = getWorkspaceView<Record<string, Place>>(here, "closed.places", {});
  const place = places[rec.id];
  if (place && rec.workspaceId === here) {
    const back = putBack(rec.id, place, layoutOf(boardOf(st)));
    if (back.order) setWorkspaceView(here, "grid.order", back.order);
    if (back.docks) setWorkspaceView(here, "docks", back.docks);
    if (back.widths) setWorkspaceView(here, "strip.widths", back.widths);
    if (back.rects) setWorkspaceView(here, "canvas.rects", back.rects);
    const { [rec.id]: _, ...rest } = places;
    setWorkspaceView(here, "closed.places", rest);
  }
  cmd.call("window.reopen", { id: rec.id }).then(
    (w) => w && select(w.id),
    (err: Error) => toast(err.message),
  );
}

/** Each render of the board: windows that are gone since the last one had their place remembered. */
export function useRememberClosed(board: Board, connected: boolean): void {
  const before = useRef<{ workspaceId: WorkspaceId; ids: string[]; layout: Layout } | null>(null);
  useEffect(() => {
    if (!connected) return;
    const layout = layoutOf(board);
    const ids = [...board.boardOrder, ...[board.docks.left.id, board.docks.right.id].filter((x): x is string => !!x)];
    const prev = before.current;
    before.current = { workspaceId: board.workspaceId, ids, layout };
    if (prev?.workspaceId !== board.workspaceId) return;
    const st = getState();
    const gone = prev.ids.filter((id) => !ids.includes(id) && !st.panes.has(id) && !st.windows.has(id));
    if (gone.length) setWorkspaceView(board.workspaceId, "closed.places", rememberPlaces(getWorkspaceView(board.workspaceId, "closed.places", {}), gone, prev.layout, Date.now()));
  }, [connected, board.boardOrder, board.docks, board.workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps
}
