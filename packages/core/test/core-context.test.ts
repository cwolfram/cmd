// The core's context (kernel/context.ts): services read when used, and loudly when one isn't
// made yet; nothing but the entry points imports Core; and the services that used to be wired
// inside Core are made from a fake context alone.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contextOf, type CoreContext } from "../src/kernel/context.ts";
import { createActions } from "../src/actions/feature.ts";
import { createJournal } from "../src/journal/feature.ts";
import { createNaming } from "../src/agents/naming.ts";
import { createSummaries } from "../src/summaries/service.ts";
import { Store } from "../src/kernel/store.ts";
import { DataService } from "../src/data/service.ts";
import { Scheduler } from "../src/kernel/scheduler.ts";
import { DEFAULT_SETTINGS } from "@cmd/protocol";

const src = path.join(import.meta.dirname, "../src");
const actions = { broadcast: () => {}, place: () => ({}) as never, opened: <W>(w: W) => w, watched: () => false, libraryChanged: () => {}, previewer: async () => null };
const noAi = { status: () => ({ ready: false }), object: async () => ({}) as never, provider: () => null, on: () => {} } as unknown as CoreContext["ai"];
const settings = { settings: { ...DEFAULT_SETTINGS }, bind: () => {} } as unknown as CoreContext["settings"];

describe("the core's context", () => {
  it("reads a service when it is used, and says which one isn't made yet", () => {
    const owner: Partial<CoreContext> = {};
    const ctx = contextOf(owner, actions);
    expect(() => ctx.ai).toThrow("core.ai was used before the core made it");
    owner.ai = noAi;
    expect(ctx.ai).toBe(noAi);
  });

  it("is the only way into the core: no service imports kernel/core.ts", () => {
    const files = (fs.readdirSync(src, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts"));
    const into = files.filter((f) => f !== "kernel/core.ts" && /from "(\.\.?\/)+(kernel\/)?core\.ts"/.test(fs.readFileSync(path.join(src, f), "utf8")));
    expect(into.sort()).toEqual(["index.ts", "main.ts"]);
  });

  it("makes the naming, summaries, actions and journal from a fake context, without a Core", async () => {
    const asked: string[] = [];
    const agents = { list: () => [], get: (id: string) => (asked.push(id), null), activity: { turns: () => [], recordedBy: "test", turnsSince: () => [] }, modelName: () => true } as unknown as CoreContext["agents"];
    const naming = createNaming({ ai: noAi, settings, agents });
    await naming.settled("a1");

    const summaries = createSummaries({ ai: noAi, agents, data: {} as never, transcripts: { get: () => undefined } as never, windows: {} as never, workspaces: {} as never, notifications: {} as never, ...actions }, null);
    await expect(summaries.start("a1")).rejects.toThrow();
    expect(asked).toContain("a1");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmd-ctx-"));
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { dev: "vite", test: "vitest" } }));
    const panes = { on: () => {}, get: () => undefined } as unknown as CoreContext["panes"];
    const store = new Store(":memory:");
    const data = new DataService({ file: null, recordedBy: "test", settings: () => settings.settings, maintenance: false });
    const a = createActions({ panes, store, data, ai: noAi, settings, windows: { list: () => [] } as never, agents, workspaces: {} as never, usage: {} as never, ...actions });
    const list = await a.list(dir);
    expect(list.actions.map((x) => x.name)).toEqual(expect.arrayContaining(["dev", "test"]));
    a.dispose();

    const journal = createJournal({ store, agents, data, sessions: { sessionsSince: () => [] } as never, workspaces: { list: () => [] } as never, ai: noAi, scheduler: new Scheduler() });
    expect(await journal.days("all", 1, "never")).toEqual([]);
    journal.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
