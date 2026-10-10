// @vitest-environment happy-dom
// One sheet at a time (shell/sheets.ts): onboarding is one of them, What's New waits behind
// it, ⌘W's close shows the next, and onboarding's steps count as seen when it goes.
import { describe, expect, it, vi } from "vitest";

const seen = vi.fn();
vi.mock("../src/renderer/src/lib/bridge.ts", () => ({ cmd: { onboardingSeen: seen } }));
const { closeSheet, currentSheet, openSheet, queueSheet, toggleSheet } = await import("../src/renderer/src/shell/sheets.ts");

describe("sheets", () => {
  it("queue What's New behind onboarding, which counts as seen when it closes", () => {
    openSheet({ kind: "setup", ids: ["ai", "hooks"] });
    queueSheet({ kind: "whatsNew", releases: [] });
    expect(currentSheet()?.kind).toBe("setup");
    closeSheet();
    expect(seen).toHaveBeenCalledWith(["ai", "hooks"]);
    expect(currentSheet()?.kind).toBe("whatsNew");
    closeSheet();
    expect(currentSheet()).toBeNull();
  });

  it("toggle the one open, replace another", () => {
    toggleSheet({ kind: "palette", query: "" });
    expect(currentSheet()).toEqual({ kind: "palette", query: "" });
    toggleSheet({ kind: "library" });
    expect(currentSheet()?.kind).toBe("library");
    toggleSheet({ kind: "library" });
    expect(currentSheet()).toBeNull();
    queueSheet({ kind: "feedback" });
    expect(currentSheet()?.kind).toBe("feedback");
  });
});
