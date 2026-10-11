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
  return { m: m as unknown as WindowManager, set: (state: Record<string, unknown>) => m.update("t1", { state }), remove: () => e.emit("removed", "t1") };
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

  it("rings a long timer past setTimeout's limit, once, on time", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const { m, set } = windows();
    const rung: string[] = [];
    const alarms = new TimerAlarms(m, (_w, _t, body) => rung.push(body));
    set({ endsAt: Date.now() + 30 * 86400_000 }); // 30 days: over 2^31 ms
    vi.advanceTimersByTime(29 * 86400_000);
    expect(rung).toEqual([]);
    vi.advanceTimersByTime(86400_000);
    expect(rung).toEqual(["Time's up"]);
    alarms.close();
  });

  it("says when a timer ended if it rings late, and never rings one whose window went", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const late = windows();
    const bodies: string[] = [];
    const a = new TimerAlarms(late.m, (_w, _t, body) => bodies.push(body));
    late.set({ endsAt: Date.now() + 60_000 });
    vi.setSystemTime(Date.now() + 10 * 60_000); // asleep through it
    vi.advanceTimersByTime(CHECK_MS);
    expect(bodies[0]).toMatch(/^Ended at /);
    a.close();
    const gone = windows();
    const rung: string[] = [];
    const b = new TimerAlarms(gone.m, (_w, title) => rung.push(title));
    gone.set({ endsAt: Date.now() + 60_000 });
    gone.remove();
    vi.advanceTimersByTime(10 * 60_000);
    expect(rung).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    b.close();
  });
});
