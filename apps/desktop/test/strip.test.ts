import { describe, expect, it } from "vitest";
import { clampWidth, currentDot, layout, maxWidth, nextPreset, revealOffset, stepFraction, widthFor, withWidth } from "../src/renderer/src/shell/board/strip.ts";

const G = 8;
const VP = 1000;

describe("strip geometry", () => {
  it("lays windows out left to right with gutters", () => {
    const { slots, total } = layout([400, 500, 300], G);
    expect(slots).toEqual([
      { x: 8, w: 400 },
      { x: 416, w: 500 },
      { x: 924, w: 300 },
    ]);
    expect(total).toBe(1232);
  });

  it("never makes a window wider than the pane", () => {
    expect(maxWidth(VP, G)).toBe(984);
    expect(clampWidth(5000, VP, G)).toBe(984);
    expect(clampWidth(100, VP, G)).toBe(320);
    expect(widthFor(1, VP, G)).toBe(984);
    expect(widthFor(0.5, VP, G)).toBe(492);
  });

  it("cycles PaperWM-style width presets", () => {
    expect(nextPreset(0.382)).toBe(0.5);
    expect(nextPreset(0.5)).toBe(0.618);
    expect(nextPreset(1)).toBe(0.382);
    expect(nextPreset(0.45)).toBe(0.5);
  });

  it("steps widths by tenths, snapping odd ones to the grid", () => {
    expect(stepFraction(0.5, 1)).toBe(0.6);
    expect(stepFraction(0.5, -1)).toBe(0.4);
    expect(stepFraction(0.618, 1)).toBe(0.7);
    expect(stepFraction(0.618, -1)).toBe(0.6);
    expect(stepFraction(1, 1)).toBe(1);
    expect(stepFraction(0.1, -1)).toBe(0.1);
    expect(stepFraction(0.4, -1, 0.25)).toBe(0.3);
    expect(stepFraction(0.3, -1, 0.25)).toBe(0.25);
  });
});

describe("reveal", () => {
  const { slots, total } = layout([400, 500, 600], G);

  it("scrolls the least needed to show a window fully", () => {
    expect(revealOffset(0, slots[0]!, VP, G, total)).toBe(0); // already visible
    expect(revealOffset(0, slots[2]!, VP, G, total)).toBe(532); // flush right
    expect(revealOffset(532, slots[0]!, VP, G, total)).toBe(0); // flush left
  });
});

describe("pagination dots", () => {
  // Five 400 px windows in a 1000 px viewport: the strip scrolls 0…1048.
  const { slots, total } = layout([400, 400, 400, 400, 400], G);
  const max = total - VP;

  it("follow the selection while it is in view", () => {
    expect(currentDot(slots, 0, 0, VP, total, true)).toBe(0);
    expect(currentDot(slots, 4, max, VP, total, true)).toBe(4);
  });

  it("move with ⌥⌘← from the last window even when nothing scrolls", () => {
    // At the end, the one before the last is in view too: selecting it takes the dot.
    expect(currentDot(slots, 3, max, VP, total, true)).toBe(3);
  });

  it("go by position once the user scrolls sideways: the last at the end, whatever is selected", () => {
    expect(currentDot(slots, 3, max, VP, total, false)).toBe(4);
    expect(currentDot(slots, 3, 0, VP, total, false)).toBe(0);
    expect(currentDot(slots, 0, max / 2, VP, total, false)).toBe(2);
  });

  it("go by position when the selection is mostly out of view", () => {
    expect(currentDot(slots, 0, max, VP, total, true)).toBe(4);
  });
});

describe("stored widths", () => {
  const live = { panes: new Map([["p1", {}], ["p2", {}]]), windows: new Map([["w1", {}]]) };

  it("keeps other windows' widths, terminals and non-terminals alike", () => {
    expect(withWidth({ p1: 0.618, w1: 0.382 }, "p2", 1, live)).toEqual({ p1: 0.618, w1: 0.382, p2: 1 });
  });

  it("drops widths of closed windows", () => {
    expect(withWidth({ p1: 0.618, gone: 0.382 }, "w1", 0.5, live)).toEqual({ p1: 0.618, w1: 0.5 });
  });
});
