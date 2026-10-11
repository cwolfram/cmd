// lineSplitter: lines across and within chunks, a limit that ends the stream,
// and a long line in many chunks in linear time.

import { describe, expect, it } from "vitest";
import { lineSplitter } from "../src/index.ts";

describe("lineSplitter", () => {
  it("splits lines across and within chunks", () => {
    const lines: string[] = [];
    const feed = lineSplitter((l) => lines.push(l));
    for (const c of ["a", "b\nc\n", "", "d", "e", "\n\nf"]) feed(c);
    expect(lines).toEqual(["ab", "c", "de", ""]);
  });

  it("stops at a line over the limit, in one chunk or many", () => {
    for (const chunks of [["0123456789\n"], ["01234", "56789", "\n"], ["ok\n0123", "456789"]]) {
      const lines: string[] = [];
      let over = 0;
      const feed = lineSplitter((l) => lines.push(l), { max: 8, tooLong: () => over++ });
      for (const c of chunks) feed(c);
      feed("after\n");
      expect(over).toBe(1);
      expect(lines.filter((l) => l !== "ok")).toEqual([]);
    }
  });

  it("takes a 5 MB line in 64 KiB chunks in under 50 ms", () => {
    const chunk = "x".repeat(64 * 1024);
    let got = 0;
    const feed = lineSplitter((l) => (got = l.length));
    const start = performance.now();
    for (let i = 0; i < 80; i++) feed(chunk);
    feed("\n");
    expect(performance.now() - start).toBeLessThan(50);
    expect(got).toBe(80 * chunk.length);
  });
});
