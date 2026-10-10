import { describe, expect, it } from "vitest";
import { dock, EMPTY_DOCKS } from "../src/renderer/src/docks.ts";
import { PLACES_KEPT, putBack, rememberPlaces, type Layout } from "../src/renderer/src/reopen.ts";

const layout = (o: Partial<Layout> = {}): Layout => ({ order: [], docks: EMPTY_DOCKS, widths: {}, rects: {}, ...o });

describe("closed windows' places", () => {
  it("puts a board window back at its index, with its width and rect", () => {
    const before = layout({ order: ["a", "b", "c"], widths: { b: 0.618 }, rects: { b: { x: 10, y: 20, w: 300, h: 200 } } });
    const places = rememberPlaces({}, ["b"], before, 1);
    expect(places.b).toMatchObject({ index: 1, side: null, width: 0.618 });
    // Pruned from the layout since; it arrives at the end.
    expect(putBack("b", places.b!, layout({ order: ["a", "c", "d"] }))).toEqual({
      order: ["a", "b", "c", "d"],
      widths: { b: 0.618 },
      rects: { b: { x: 10, y: 20, w: 300, h: 200 } },
    });
    // Fewer windows than before: last.
    expect(putBack("b", { ...places.b!, index: 5 }, layout({ order: ["a"] })).order).toEqual(["a", "b"]);
    // Already where it was: nothing to change.
    expect(putBack("b", places.b!, layout({ order: ["a", "b"], widths: { b: 0.5 }, rects: { b: { x: 0, y: 0, w: 1, h: 1 } } }))).toEqual({});
  });

  it("docks a sidebar back on its side, unless another window took it", () => {
    const places = rememberPlaces({}, ["nav"], layout({ docks: dock(EMPTY_DOCKS, "nav", "left") }), 1);
    expect(places.nav).toMatchObject({ index: null, side: "left" });
    expect(putBack("nav", places.nav!, layout()).docks?.left.id).toBe("nav");
    expect(putBack("nav", places.nav!, layout({ docks: dock(EMPTY_DOCKS, "files", "left") })).docks).toBeUndefined();
  });

  it("keeps the newest", () => {
    let places = {};
    for (let i = 0; i < PLACES_KEPT + 5; i++) places = rememberPlaces(places, [`w${i}`], layout({ order: [`w${i}`] }), i);
    expect(Object.keys(places)).toHaveLength(PLACES_KEPT);
    expect(places).toHaveProperty(`w${PLACES_KEPT + 4}`);
    expect(places).not.toHaveProperty("w0");
  });
});
