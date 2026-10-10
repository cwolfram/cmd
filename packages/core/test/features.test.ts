// Features declared in their own folders (kernel/features.ts): each handles only its own
// methods (named after it), no two declare the same one, and the core serves them all.
import { afterAll, describe, expect, it } from "vitest";
import { Core } from "../src/kernel/core.ts";
import { FEATURES } from "../src/kernel/features.ts";
import { fakeFactory } from "./fake-pty.ts";

describe("features", () => {
  const core = new Core({ socketPath: "/dev/null", dbPath: null, settingsPath: null, terminals: fakeFactory().factory, pollMs: 0 });
  afterAll(() => core.close());
  const slices = FEATURES.map((f) => [f.id, Object.keys(f.handlers(core))] as const);

  it("name their methods after themselves", () => {
    for (const [id, methods] of slices) {
      expect(methods.length).toBeGreaterThan(0);
      expect(methods.filter((m) => !m.startsWith(`${id}.`))).toEqual([]);
    }
  });

  it("never declare the same method twice, and the core serves each one", () => {
    const all = slices.flatMap(([, m]) => m);
    expect(new Set(all).size).toBe(all.length);
    for (const m of all) expect(typeof (core.handlers as Record<string, unknown>)[m]).toBe("function");
  });
});
