// The procinfo helper's client (AR1-04-09): a helper that stops answering costs
// one poll, not every one after it, and long requests keep answers matched.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProcInfo } from "../src/agents/procinfo.ts";
import { PaneManager } from "../src/terminals/panes.ts";
import { needs } from "../../../test/system.ts";
import { fakeFactory } from "./fake-pty.ts";

const open: ProcInfo[] = [];
afterEach(() => {
  open.splice(0).forEach((p) => p.close());
});

/**
 * A fake helper: `sh -c` with a loop that reads requests and runs `body` for each. Not a
 * script file: macOS checks a newly written executable on its first run, one at a time
 * across the machine (~90 ms each), so under a parallel test run a fresh file's first
 * answer could queue past the deadline.
 */
function helper(body: string, o: { timeoutMs?: number } = {}): ProcInfo {
  const p = new ProcInfo("/bin/sh", { ...o, args: ["-c", `while IFS= read -r line; do\n${body}\ndone\n`] });
  open.push(p);
  return p;
}

describe("procinfo helper", () => {
  it("gives up on a helper that doesn't answer, and the next poll runs on a new one", async () => {
    const marker = path.join(os.tmpdir(), `cmd-procinfo-${process.pid}-${Date.now()}`);
    // The first helper hangs; the one started after it answers.
    const p = helper(`if [ -e "${marker}" ]; then echo '{"fg":4242,"start":1,"path":"/usr/bin/vim","argv":["vim"]}'; else touch "${marker}"; sleep 30; fi`, { timeoutMs: 300 });
    const f = fakeFactory();
    const panes = new PaneManager(f.factory, { socketPath: "/tmp/t.sock", pollMs: 0, inspector: (pid) => p.query(pid) });
    panes.create();
    const t0 = Date.now();
    await panes.pollForeground();
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(p.stalls).toBe(1);
    // A new helper (on a loaded machine its shell may itself miss the short deadline once).
    let info = null;
    for (let i = 0; i < 5 && !info; i++) info = await p.query(1);
    expect(info).toMatchObject({ pid: 4242, path: "/usr/bin/vim" });
    fs.rmSync(marker, { force: true });
  });

  it("splits a long request into lines and keeps every answer with its caller", async () => {
    // Answers each line with how many words it had: a request cut in two would answer twice.
    const p = helper(`set -- $line; if [ "$1" = t ]; then shift; echo "[{\\"pid\\":$#,\\"mem\\":0,\\"cpu\\":0,\\"procs\\":1,\\"top\\":[]}]"; else echo "{\\"fg\\":$1,\\"argv\\":[]}"; fi`);
    const pids = Array.from({ length: 3000 }, (_, i) => 100000 + i);
    const [trees, q] = await Promise.all([p.trees(pids), p.query(77)]);
    expect(trees.reduce((n, t) => n + t.pid, 0)).toBe(3000);
    expect(q).toMatchObject({ pid: 77 });
  });

  it.skipIf(process.platform !== "darwin" || needs(new ProcInfo().available, "procinfo helper (pnpm install builds native/build/procinfo)"))("the real helper answers a 3,000-pid line once", async () => {
    const p = new ProcInfo();
    open.push(p);
    const pids = Array.from({ length: 3000 }, (_, i) => (i ? 900000 + i : process.pid));
    expect((await p.procs(pids)).map((u) => u.pid)).toEqual([process.pid]);
    expect(await p.query(process.pid)).toMatchObject({ pid: expect.any(Number) });
  });
});
