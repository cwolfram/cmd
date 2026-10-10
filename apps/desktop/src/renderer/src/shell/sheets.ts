// What sits over the board: one sheet at a time (the command palette, a picker, the Widget
// Library, What's New, Feedback, the Task Manager), opened by commands from anywhere and
// closed by ⌘W (the top one first). Onboarding is its own (onboarding/Onboarding.tsx); What's
// New waits for it to close.

import { useSyncExternalStore } from "react";
import type { Release } from "../../../shared/changelog.ts";
import { closeSetup, setupOpen } from "../onboarding/Onboarding.tsx";
import type { Picker } from "./workspaces.tsx";

export type Sheet =
  /** The palette, with what is typed in it ("?" for search, docs/33). */
  | { kind: "palette"; query: string }
  | { kind: "picker"; picker: Picker }
  | { kind: "library" }
  | { kind: "whatsNew"; releases: Release[] }
  | { kind: "feedback" }
  | { kind: "taskManager" };

let sheet: Sheet | null = null;
const listeners = new Set<() => void>();
/** What's New, waiting for onboarding to close. */
let whatsNewLater: Release[] | null = null;

export function currentSheet(): Sheet | null {
  return sheet;
}

export function openSheet(next: Sheet | null): void {
  sheet = next;
  for (const fn of listeners) fn();
}

export function closeSheet(): void {
  openSheet(null);
}

/** Open it, or close it if it is the one open (⌘K, ⌘N, ⇧⌘L). */
export function toggleSheet(next: Sheet, same: (s: Sheet) => boolean = (s) => s.kind === next.kind): void {
  openSheet(sheet && same(sheet) ? null : next);
}

export function useSheet(): Sheet | null {
  return useSyncExternalStore(
    (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    () => sheet,
  );
}

/** What's New now, or once onboarding closes. */
export function showWhatsNew(releases: Release[]): void {
  if (setupOpen()) whatsNewLater = releases;
  else openSheet({ kind: "whatsNew", releases });
}

/** Onboarding closes, and What's New shows if it waited. */
export function endSetup(): void {
  closeSetup();
  if (whatsNewLater) openSheet({ kind: "whatsNew", releases: whatsNewLater }), (whatsNewLater = null);
}
