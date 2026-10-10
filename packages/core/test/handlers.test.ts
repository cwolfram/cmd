// Core.handlers is every folder's slice (kernel/slices.ts) plus the features' (kernel/features.ts)
// plus Core's own three: each method in exactly one of them, every one served.
import { describe, expect, it } from "vitest";
import { SLICES } from "../src/kernel/slices.ts";
import { ALL } from "../src/kernel/features.ts";
import { Core } from "../src/kernel/core.ts";
import { fakeFactory } from "./fake-pty.ts";

describe("handlers", () => {
  // Handlers only close over the context: building them reads nothing.
  const slices = [...Object.entries(SLICES).map(([name, s]) => [name, Object.keys(s({} as never))] as const), ...ALL.filter((f) => f.handlers).map((f) => [f.id, Object.keys(f.handlers!({} as never))] as const)];

  it("are declared once, across every slice", () => {
    const where = new Map<string, string[]>();
    for (const [name, methods] of slices) for (const m of methods) where.set(m, [...(where.get(m) ?? []), name]);
    expect([...where].filter(([, names]) => names.length > 1)).toEqual([]);
  });

  it("are all served, with only core.hello, core.info and events.subscribe in core.ts itself", async () => {
    const core = new Core({ socketPath: "/dev/null", dbPath: null, settingsPath: null, terminals: fakeFactory().factory, pollMs: 0 });
    const sliced = new Set(slices.flatMap(([, m]) => m));
    expect(Object.keys(core.handlers).filter((m) => !sliced.has(m)).sort()).toEqual(["core.hello", "core.info", "events.subscribe"]);
    await core.close();
  });
});
