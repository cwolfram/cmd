// @vitest-environment happy-dom
// What a text window reads from a file before showing it (editor/setup.ts): its indentation and line endings.
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { detectIndent, fileFormat, lineBreakOf } from "../src/renderer/src/editor/setup.ts";

describe("detectIndent", () => {
  it("finds tabs, two and four spaces", () => {
    expect(detectIndent("a {\n\tb;\n\t\tc;\n}\n").unit).toBe("\t");
    expect(detectIndent("a:\n  b:\n    c: 1\n  d: 2\n").unit).toBe("  ");
    expect(detectIndent("def f():\n    if x:\n        y()\n    return\n").unit).toBe("    ");
  });

  it("doesn't take a block comment's one-space continuation for a level, and defaults to two", () => {
    expect(detectIndent("/**\n * doc\n * more\n */\nf() {\n    g();\n}\n").unit).toBe("    ");
    expect(detectIndent("no indentation here\nat all\n").unit).toBe("  ");
  });
});

describe("line endings", () => {
  it("keeps CRLF only when every break is one", () => {
    expect(lineBreakOf("a\r\nb\r\n")).toBe("\r\n");
    expect(lineBreakOf("a\nb\n")).toBeNull();
    expect(lineBreakOf("a\r\nb\n")).toBeNull();
  });

  it("writes a CRLF file back with CRLF", () => {
    const text = "one\r\ntwo\r\nthree\r\n";
    const state = EditorState.create({ doc: text, extensions: fileFormat(text) });
    expect(state.doc.lines).toBe(4);
    expect(state.sliceDoc()).toBe(text);
    const edited = state.update({ changes: { from: state.doc.line(2).to, insert: "\r\nmore" } }).state;
    expect(edited.sliceDoc()).toBe("one\r\ntwo\r\nmore\r\nthree\r\n");
  });
});
