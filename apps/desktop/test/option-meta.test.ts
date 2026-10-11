import { describe, expect, it } from "vitest";
import { optionIsMeta } from "../src/renderer/src/windows/terminal/option.ts";

describe("Option as Meta", () => {
  it("types the ASCII a layout puts on Option when set to both", () => {
    for (const k of ["@", "[", "]", "|", "\\", "{", "}", "~", "€"]) expect(optionIsMeta("both", "left", k)).toBe(false);
  });

  it("keeps Meta for letters, digits and non-ASCII when set to both", () => {
    for (const k of ["b", "f", "B", "1", "¬", "∫", "ƒ", "Dead", "ArrowLeft", "Alt"]) expect(optionIsMeta("both", "right", k)).toBe(true);
  });

  it("follows the side it is set to, whatever the key types", () => {
    expect(optionIsMeta("left", "left", "@")).toBe(true);
    expect(optionIsMeta("left", "right", "b")).toBe(false);
    expect(optionIsMeta("right", "right", "b")).toBe(true);
    expect(optionIsMeta("off", "left", "b")).toBe(false);
  });
});
