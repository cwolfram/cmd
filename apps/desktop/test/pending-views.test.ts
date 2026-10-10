import { describe, expect, it } from "vitest";
import { PendingViews } from "../src/renderer/src/pendingViews.ts";

const WS = "home";

/** The core's side: applies sends in order; each answer comes after its broadcast (one socket). */
function core() {
  let view: Record<string, unknown> = {};
  return {
    apply(patch: Record<string, unknown>): Record<string, unknown> {
      view = { ...view, ...patch };
      return view; // the workspace.updated it broadcasts
    },
  };
}

describe("pending workspace view writes", () => {
  it("a local write shows over what the core sends until its call is answered", () => {
    const p = new PendingViews();
    p.set(WS, "selection.pane", "b");
    expect(p.over(WS, { "selection.pane": "a" })["selection.pane"]).toBe("b");
    const send = p.take(WS)!;
    expect(send.view).toEqual({ "selection.pane": "b" });
    expect(p.over(WS, { "selection.pane": "a" })["selection.pane"]).toBe("b"); // an update from before it arrived
    send.settle();
    expect(p.over(WS, { "selection.pane": "a" })["selection.pane"]).toBe("a"); // from now on the core's word counts
    expect(p.take(WS)).toBeNull();
  });

  // The smoke's mru flake: new terminal selected (sent), first selected (sent), newest selected
  // again (not sent yet), then ⌘W. The core echoes the first send late: it equals the local
  // value, which used to count as the answer, so the next echo (first) took over and nothing
  // sent newest again. ⌘W then closed first, and the selection went to newest.
  it("an echo of an older write that equals the local value doesn't end it (A, B, A)", () => {
    const p = new PendingViews();
    const c = core();
    p.set(WS, "selection.pane", "newest");
    const s1 = p.take(WS)!;
    p.set(WS, "selection.pane", "first");
    const s2 = p.take(WS)!;
    p.set(WS, "selection.pane", "newest"); // in its 250 ms debounce

    const e1 = c.apply(s1.view);
    expect(p.over(WS, e1)["selection.pane"]).toBe("newest");
    s1.settle();
    const e2 = c.apply(s2.view);
    expect(p.over(WS, e2)["selection.pane"]).toBe("newest"); // was "first"
    s2.settle();
    expect(p.over(WS, e2)["selection.pane"]).toBe("newest");

    const s3 = p.take(WS)!; // and it still goes to the core
    expect(s3.view).toEqual({ "selection.pane": "newest" });
    const e3 = c.apply(s3.view);
    s3.settle();
    expect(p.over(WS, e3)["selection.pane"]).toBe("newest");
    expect(e3["selection.pane"]).toBe("newest");
  });

  it("an answer to an older write keeps a newer one of the same key", () => {
    const p = new PendingViews();
    p.set(WS, "selection.history", ["a"]);
    const s1 = p.take(WS)!;
    p.set(WS, "selection.history", ["b", "a"]);
    s1.settle();
    expect(p.over(WS, { "selection.history": ["a"] })["selection.history"]).toEqual(["b", "a"]);
    expect(p.take(WS)!.view).toEqual({ "selection.history": ["b", "a"] });
  });

  it("sends only what changed since the last send, null for a removed value", () => {
    const p = new PendingViews();
    p.set(WS, "grid.order", ["a"]);
    p.set(WS, "view.mode", "grid");
    p.take(WS);
    p.set(WS, "view.mode", undefined);
    expect(p.take(WS)!.view).toEqual({ "view.mode": null });
    expect(p.over(WS, { "grid.order": [], "view.mode": "strip" })).toEqual({ "grid.order": ["a"], "view.mode": undefined });
  });

  it("keeps workspaces apart", () => {
    const p = new PendingViews();
    p.set("a", "k", 1);
    expect(p.over("b", { k: 2 })).toEqual({ k: 2 });
    expect(p.take("b")).toBeNull();
  });
});
