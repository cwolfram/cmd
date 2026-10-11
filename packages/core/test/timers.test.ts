// Timer widgets ring on the wall clock (windows/timers.ts): Node's timers stop while
// the Mac sleeps, so a check while a timer runs rings what's due after a wake.

import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppWindow } from "@cmd/protocol";
import { CHECK_MS, TimerAlarms } from "../src/windows/timers.ts";
import type { WindowManager } from "../src/windows/index.ts";

/** The windows a TimerAlarms sees: one timer whose state the test sets. */
function windows() {
  const e = new EventEmitter();
  let w: AppWindow = { id: "t1", kind: "timer", title: "Timer", workspaceId: "s", createdAt: 0, state: { duration: 600_000, endsAt: null } } as unknown as AppWindow;
  const m = {
    on: (ev: string, fn: (...a: unknown[]) => void) => e.on(ev, fn),
    list: () => [w],
    update: (_id: string, p: { state: Record<string, unknown> }) => {
      w = { ...w, state: p.state.action === "ring" ? { ...w.state, endsAt: null, rang: true } : { ...w.state, ...p.state } } as AppWindow;
      e.emit("updated", w);
      return w;
    },
  };
  return { m: m as unknown as WindowManager, set: (state: Record<string, unknown>) => m.update("t1", { state }) };
}

afterEach(() => vi.useRealTimers());

describe("timers", () => {
  it("ring after a sleep within one check, once", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const { m, set } = windows();
    const rung: string[] = [];
    const alarms = new TimerAlarms(m, (_w, title) => rung.push(title));
    expect(vi.getTimerCount()).toBe(0); // no timer running: nothing armed, no check either
    set({ endsAt: Date.now() + 10 * 60_000 });
    expect(vi.getTimerCount()).toBe(2);
    // The Mac sleeps 11 minutes: the wall clock moves, Node's timers don't.
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect(rung).toEqual([]);
    vi.advanceTimersByTime(CHECK_MS);
    expect(rung).toHaveLength(1);
    vi.advanceTimersByTime(10 * 60_000);
    expect(rung).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0); // rung: the check stops with it
    alarms.close();
  });
});
