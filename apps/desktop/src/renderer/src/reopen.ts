// Where a closed window was, so it comes back there when it's reopened (⇧⌘T,
// the Navigator's Recent). The core reopens a window under its old id; the layout
// keys (grid.order, strip.widths, canvas.rects, docks) drop ids that are gone
// whenever they're written, so each workspace keeps the place of its closed
// windows in its view as `closed.places`, as pure functions here.

import { dock, sideOf, type Docks, type Side } from "./docks.ts";
import type { Rect } from "./layouts.ts";

export interface Place {
  /** Index on the board (grid and strip order); null: it was docked. */
  index: number | null;
  side: Side | null;
  width?: number;
  rect?: Rect;
  closedAt: number;
}

/** As many as the core keeps per workspace (CLOSED_PER_WORKSPACE). */
export const PLACES_KEPT = 20;

export interface Layout {
  /** The board's order as shown. */
  order: string[];
  docks: Docks;
  widths: Record<string, number>;
  rects: Record<string, Rect>;
}

/** Remember where the `gone` windows were in `before`, newest kept. */
export function rememberPlaces(places: Record<string, Place>, gone: string[], before: Layout, now: number): Record<string, Place> {
  const next = { ...places };
  for (const id of gone) {
    const side = sideOf(before.docks, id);
    const index = before.order.indexOf(id);
    next[id] = {
      index: side || index < 0 ? null : index,
      side,
      ...(before.widths[id] !== undefined ? { width: before.widths[id] } : {}),
      ...(before.rects[id] ? { rect: before.rects[id] } : {}),
      closedAt: now,
    };
  }
  const kept = Object.entries(next).sort((a, b) => b[1].closedAt - a[1].closedAt).slice(0, PLACES_KEPT);
  return Object.fromEntries(kept);
}

/** The layout with a reopened window put back where it was. Only what changed is returned. */
export function putBack(id: string, place: Place, now: Layout): Partial<Layout> {
  const out: Partial<Layout> = {};
  if (place.side) {
    // Its side may have another window by now: that one stays, and this one goes on the board.
    if (!now.docks[place.side].id && sideOf(now.docks, id) === null) out.docks = dock(now.docks, id, place.side);
  } else if (place.index !== null) {
    const rest = now.order.filter((x) => x !== id);
    rest.splice(Math.min(place.index, rest.length), 0, id);
    if (rest.join("\n") !== now.order.join("\n")) out.order = rest;
  }
  if (place.width !== undefined && now.widths[id] === undefined) out.widths = { ...now.widths, [id]: place.width };
  if (place.rect && !now.rects[id]) out.rects = { ...now.rects, [id]: place.rect };
  return out;
}
