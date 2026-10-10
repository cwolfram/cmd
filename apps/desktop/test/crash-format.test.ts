import os from "node:os";
import { describe, expect, it } from "vitest";
import type { CrashReport } from "@cmd/protocol/node";
import { payload, scrub, signature, withRepeats } from "../src/main/crash-format.ts";

const report = (o: Partial<CrashReport> = {}): CrashReport => ({
  id: "abc",
  time: "2026-10-04T00:00:00.000Z",
  process: "core",
  kind: "uncaughtException",
  message: "TypeError: Cannot read properties of undefined (reading 'pid')",
  stack: `TypeError: Cannot read properties of undefined\n    at PaneManager.kill (${os.homedir()}/src/cmd/packages/core/src/panes.ts:447:10)`,
  context: { version: "0.2.6", channel: "release", platform: "darwin 25.4.0 arm64", build: "abcdef" },
  log: [],
  ...o,
});

describe("crash reports", () => {
  it("replace home folders with ~", () => {
    expect(scrub(`${os.homedir()}/x and /Users/someone/y`)).toBe("~/x and ~/y");
    expect(scrub('"C:\\\\Users\\\\someone\\\\x"')).toBe('"~\\\\x"');
  });

  it("treat the same crash at other lines and paths as a repeat", () => {
    const a = signature(report());
    const b = signature(report({ stack: "TypeError: Cannot read properties of undefined\n    at PaneManager.kill (/elsewhere/panes.ts:450:3)" }));
    const other = signature(report({ message: "RangeError: Invalid array length" }));
    expect(a).toBe(b);
    expect(a).not.toBe(other);
  });

  it("treat the same crash about another pane, agent or build as a repeat", () => {
    const pane = (id: string) => signature(report({ process: "renderer", message: `Error: no such pane: ${id}`, stack: null }));
    expect(pane("29b61838-532e-45cb-8f79-ece79886e698")).toBe(pane("2bc7bffa-6932-484b-96e1-22f3b95eca81"));
    const agent = (id: string) => signature(report({ message: `Error: agent ${id} is gone`, stack: null }));
    expect(agent("6d852f69")).toBe(agent("efbaf79b"));
    expect(signature(report({ message: "Error: no such column: space_id" }))).not.toBe(signature(report({ message: "Error: no such column: window_id" })));
    expect(signature(report({ message: "Error: database is locked" }))).not.toBe(signature(report({ message: "Error: database is corrupt" })));
  });

  it("make a Discord embed without the user's home", () => {
    const p = payload(report(), 3);
    const e = p.embeds[0];
    expect(e!.title).toBe("core: TypeError: Cannot read properties of undefined (reading 'pid')");
    expect(e!.description).toContain("~/src/cmd/packages/core/src/panes.ts:447:10");
    expect(e!.description).not.toContain(os.homedir());
    expect(e!.fields.map((f) => f.name)).toEqual(["Version", "Process", "Platform", "build", "Repeats"]);
  });

  it("edit a post to say how often its crash came back, keeping one Repeats field", () => {
    const posted = payload(report());
    expect(posted.embeds[0]!.fields.map((f) => f.name)).not.toContain("Repeats");
    const once = withRepeats(posted, 1, Date.parse("2026-10-10T03:07:56Z"));
    const twice = withRepeats(once, 4, Date.parse("2026-10-10T03:08:34Z"));
    expect(twice.embeds[0]!.fields.filter((f) => f.name === "Repeats")).toEqual([{ name: "Repeats", value: "4 more, last <t:1791601714:R>", inline: true }]);
    expect(twice.embeds[0]!.title).toBe(posted.embeds[0]!.title);
  });
});
