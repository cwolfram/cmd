// What the screens share beyond @cmd/ui: an item's status light (the desktop
// sidebar's states, drawn by the kit's StatusDot) and short ages.

import type { DotState } from "@cmd/ui";

/** needs (orange), unseen (green), working (blue), done, idle: the sidebar's lights. */
export type Light = Extract<DotState, "needs" | "unseen" | "working" | "done" | "idle">;

export function ago(t: number): string {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
