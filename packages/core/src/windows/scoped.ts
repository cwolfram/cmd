// Built-in list widgets (Commands, Notifications, Journal, Resources) as one shape of window
// type: a scope (this workspace or all of them) plus on/off flags.

import type { WindowType } from "./types.ts";

export type Scope = "workspace" | "all";
export const scopeOf = (v: unknown, fallback: Scope = "workspace"): Scope => (v === "all" || v === "workspace" ? v : fallback);

/** A built-in widget showing its workspace's things or every workspace's, plus on/off `flags` (e.g. Failed Only). */
export function scopedWidget(kind: string, title: string, icon: string, description: string, flags: string[] = []): WindowType<{ scope: Scope } & Record<string, unknown>> {
  return {
    kind,
    title,
    icon,
    role: "widget",
    description,
    create(input) {
      return { state: { scope: scopeOf(input.scope) }, title };
    },
    update(state, patch) {
      const next: { scope: Scope } & Record<string, unknown> = { ...state, scope: scopeOf(patch.scope, state.scope) };
      for (const f of flags) if (typeof patch[f] === "boolean") next[f] = patch[f];
      return { state: next };
    },
  };
}
