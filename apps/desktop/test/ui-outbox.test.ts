// UI state writes (ui.set) survive a core restart: a value set while the call
// can't reach the core shows over the reconnect's snapshot and is sent again (AR1-08-06).
import { afterEach, describe, expect, it, vi } from "vitest";
import { UiOutbox } from "../src/renderer/src/lib/uiOutbox.ts";

afterEach(() => vi.useRealTimers());

describe("UI state outbox", () => {
  it("sends a key's latest value once after the delay, and again after a reconnect when that failed", async () => {
    vi.useFakeTimers();
    const sent: [string, unknown][] = [];
    let up = false;
    const o = new UiOutbox(async (k, v) => {
      sent.push([k, v]);
      if (!up) throw new Error("core restarting");
    });
    o.set("k", 1);
    o.set("k", 2);
    await vi.advanceTimersByTimeAsync(300);
    expect(sent).toEqual([["k", 2]]);
    expect(o.over({ k: 0 }).k).toBe(2); // the reconnect's snapshot doesn't undo it
    up = true;
    o.resend();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([["k", 2], ["k", 2]]);
    expect(o.keys()).toEqual([]);
    o.resend();
    expect(sent).toHaveLength(2);
  });

  it("flush sends what waits for its delay now", () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const o = new UiOutbox(async (k) => void sent.push(k));
    o.set("a", 1);
    o.flush();
    expect(sent).toEqual(["a"]);
  });

  it("keeps a value whose call failed over the reconnect's snapshot, and sends it again", () => {
    const o = new UiOutbox();
    o.set("sidebar.left", { width: 300 });
    o.take("sidebar.left"); // the call fails: done never runs
    expect(o.over({ "sidebar.left": { width: 240 }, other: 1 })).toEqual({ "sidebar.left": { width: 300 }, other: 1 });
    expect(o.keys()).toEqual(["sidebar.left"]);
    const again = o.take("sidebar.left")!;
    expect(again.value).toEqual({ width: 300 });
    again.done();
    expect(o.keys()).toEqual([]);
    expect(o.over({ "sidebar.left": { width: 300 } })).toEqual({ "sidebar.left": { width: 300 } });
  });

  it("an answer for an older value doesn't end a newer one", () => {
    const o = new UiOutbox();
    o.set("k", 1);
    const first = o.take("k")!;
    o.set("k", 2);
    first.done();
    expect(o.over({ k: 1 }).k).toBe(2);
    expect(o.take("k")!.value).toBe(2);
  });
});
