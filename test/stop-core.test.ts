// scripts/stop-core.mjs finds every core a worktree's cleanup has to stop: the instances
// inside a home (.cmd-dev/e2e-*, workbench), and a core whose pid file is gone (deleted
// with its worktree while it ran), asked for its pids over its socket.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Core } from "../packages/core/src/index.ts";
import { fakeFactory } from "../packages/core/test/fake-pty.ts";
// @ts-expect-error: a plain .mjs script, no types
import { askPids, nestedHomes } from "../scripts/stop-core.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmd-stop-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("stop-core", () => {
  it("finds the instances inside a home, two levels down", () => {
    const home = path.join(dir, ".cmd-dev");
    const at = (p: string, file: string) => (fs.mkdirSync(path.join(home, p), { recursive: true }), fs.writeFileSync(path.join(home, p, file), ""));
    at("e2e-1", "core.pid");
    at("workbench", "core.sock");
    at("shots/home", "ptyhost.pid");
    at("logs", "core.log");
    at("a/b/c", "core.pid"); // too deep
    expect((nestedHomes(home) as string[]).map((h) => path.relative(home, h)).sort()).toEqual(["e2e-1", "shots/home", "workbench"]);
  });

  it("asks a core for its pid over its socket when there's no pid file", async () => {
    const home = path.join(dir, "orphan");
    const core = new Core({ socketPath: path.join(home, "core.sock"), dbPath: null, terminals: fakeFactory().factory, pollMs: 0 });
    await core.listen();
    try {
      expect(await askPids(home)).toMatchObject({ core: process.pid });
      expect(await askPids(path.join(dir, "nothing-here"))).toBeNull();
    } finally {
      await core.close();
    }
  });
});
