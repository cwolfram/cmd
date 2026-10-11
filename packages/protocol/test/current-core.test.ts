// isCurrentCore: one rule for main's restart and the footer's "outdated".

import { describe, expect, it } from "vitest";
import { isCurrentCore, PROTOCOL } from "../src/index.ts";

const app = { build: "b1", root: "/Applications/cmd.app/runtime/b1" };

describe("isCurrentCore", () => {
  it("is this app's core only with its protocol, build and code folder", () => {
    expect(isCurrentCore({ protocol: PROTOCOL, build: "b1", root: "/Applications/cmd.app/runtime/b1/" }, app)).toBe(true);
    expect(isCurrentCore({ protocol: PROTOCOL, build: "b2", root: app.root }, app)).toBe(false);
    // The same build from another checkout (a worktree's core): another core.
    expect(isCurrentCore({ protocol: PROTOCOL, build: "b1", root: "/Users/me/src/cmd-topic" }, app)).toBe(false);
    expect(isCurrentCore({ protocol: PROTOCOL + 1, build: "b1", root: app.root }, app)).toBe(false);
    // A core from before protocols: not this app's.
    expect(isCurrentCore({ build: "b1", root: app.root }, app)).toBe(false);
  });
});
