// Rings Timer widgets (windows/builtin.ts timerType) from the core, so a timer
// ends on time whether or not its workspace is on screen or the app is open: one
// setTimeout per running timer, set again whenever its window changes. Node's
// timers run on a clock that stops while the Mac sleeps, so while any timer runs a
// check every CHECK_MS compares the wall clock with each end and rings what's due
// (a wake, a clock change). When it fires, the window is marked rung and a
// notification goes out.

import type { AppWindow, WindowId } from "@cmd/protocol";
import type { WindowManager } from "./index.ts";
import type { CoreContext } from "../kernel/context.ts";
import type { Feature } from "../kernel/features.ts";
import { durationLabel, type TimerState } from "./builtin.ts";

/** setTimeout's limit; a longer wait is set again when it fires. */
const MAX_WAIT = 2 ** 31 - 1;
/** How often running timers are checked against the wall clock. */
export const CHECK_MS = 15_000;

export class TimerAlarms {
  #windows: WindowManager;
  #ring: (w: AppWindow, title: string, body: string) => void;
  #timers = new Map<WindowId, { endsAt: number; timer: NodeJS.Timeout }>();
  /** Runs only while a timer does. */
  #check: NodeJS.Timeout | null = null;

  constructor(windows: WindowManager, ring: (w: AppWindow, title: string, body: string) => void) {
    this.#windows = windows;
    this.#ring = ring;
    windows.on("updated", (w) => this.#sync(w));
    windows.on("removed", (id) => this.#clear(id));
    for (const w of windows.list()) this.#sync(w);
  }

  #sync(w: AppWindow): void {
    if (w.kind !== "timer") return;
    const endsAt = (w.state as TimerState).endsAt;
    const cur = this.#timers.get(w.id);
    if (cur?.endsAt === endsAt) return;
    this.#clear(w.id);
    if (typeof endsAt !== "number") return;
    const timer = setTimeout(() => this.#fire(w.id, endsAt), Math.min(MAX_WAIT, Math.max(0, endsAt - Date.now())));
    timer.unref();
    this.#timers.set(w.id, { endsAt, timer });
    this.#check ??= setInterval(() => {
      for (const [id, t] of [...this.#timers]) if (Date.now() >= t.endsAt) this.#fire(id, t.endsAt);
    }, CHECK_MS);
    this.#check.unref();
  }

  #fire(id: WindowId, endsAt: number): void {
    this.#clear(id);
    const w = this.#windows.list().find((x) => x.id === id);
    if (!w || (w.state as TimerState).endsAt !== endsAt) return;
    if (endsAt > Date.now() + 1000) return this.#sync(w); // waited MAX_WAIT; more to go
    // A timer that ended long ago (the Mac slept, cmd wasn't running) still rings once.
    const late = Date.now() - endsAt > 60_000;
    const updated = this.#windows.update(id, { state: { action: "ring" } });
    const s = updated.state as TimerState;
    this.#ring(updated, `${durationLabel(s.duration)} timer · done`, late ? `Ended at ${new Date(endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Time's up");
  }

  #clear(id: WindowId): void {
    const cur = this.#timers.get(id);
    if (cur) clearTimeout(cur.timer);
    this.#timers.delete(id);
    if (!this.#timers.size && this.#check) clearInterval(this.#check), (this.#check = null);
  }

  close(): void {
    for (const id of [...this.#timers.keys()]) this.#clear(id);
  }
}

/** The alarms (`core.timers`): a timer rings as a notification on its window. */
export function createTimers(core: Pick<CoreContext, "windows" | "notifications">): TimerAlarms {
  return new TimerAlarms(core.windows, (w, title, body) => core.notifications.window(w.id, "timer", title, body));
}

/** Timers as a feature (kernel/features.ts); the Timer widget's type is with the others (builtin.ts). */
export const timersFeature = { id: "timers", dispose: (core: CoreContext) => core.timers.close() } satisfies Feature;
