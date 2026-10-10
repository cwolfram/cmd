// The selection follows the board: when the selected window goes away, the one used before it
// is selected (model.nextAfterClose), else the first; and what is selected is what new windows
// open beside, what the status bar shows the usage of.

import { useEffect, useRef } from "react";
import type { PaneId } from "@cmd/protocol";
import { windowSelected } from "../lib/actions.ts";
import { nextAfterClose } from "../lib/model.ts";
import { clear, history, isDeselected, select } from "../lib/selection.ts";
import { setUsageShown } from "../lib/store.ts";
import type { Board } from "./board/board.ts";

export function useSelectionFollows(board: Board, selected: PaneId | null, connected: boolean): void {
  const orderBefore = useRef<PaneId[]>([]);
  // Runs once the core's state, including the remembered selection, has arrived.
  useEffect(() => {
    if (!connected) return;
    const { shown, order, mode } = board;
    if (selected && (shown.panes.has(selected) || shown.windows.has(selected))) return;
    if (!selected && isDeselected() && mode === "canvas") return;
    const alive = new Set(order);
    const h = history();
    const next = selected ? nextAfterClose(selected, h, orderBefore.current, alive) : (h.find((id) => alive.has(id)) ?? order[0] ?? null);
    if (next !== selected) {
      if (next) select(next);
      else clear();
    }
  }, [connected, board.shown.panes, board.order.join(), selected, board.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  // This render's order for the next close (after the effect above, so it still sees the order from before the window went).
  useEffect(() => {
    orderBefore.current = board.order;
  }, [board.order.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    windowSelected(selected);
    setUsageShown(selected);
  }, [selected]);
}
