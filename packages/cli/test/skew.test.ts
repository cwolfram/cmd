// The CLI against a core of another protocol (core.hello): it says so and
// exits 2 instead of failing on a method that changed; a core of its own
// protocol, or one too old to say, is used as is.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PROTOCOL, type CoreHello } from "@cmd/protocol";
import { skewMessage } from "../src/skew.ts";

const MAIN = path.join(import.meta.dirname, "../src/main.ts");
const servers: net.Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

/** A core that answers core.hello with `hello` and every other call with an empty list. */
async function fakeCore(hello: Partial<CoreHello>): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmd-skew-"));
  const sock = path.join(dir, "core.sock");
  const server = net.createServer((c) => {
    let buf = "";
    c.on("data", (d) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const req = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        const result = req.method === "core.hello" ? { pid: 1, socket: sock, build: "x", stateDir: dir, ...hello } : [];
        c.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }) + "\n");
      }
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(sock, r));
  return sock;
}

function cli(sock: string, ...args: string[]): Promise<{ code: number | null; stderr: string; stdout: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["--no-warnings", MAIN, ...args], { env: { ...process.env, CMD_SOCKET: sock, CMD_PANE_ID: "" } });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (code) => resolve({ code, stderr, stdout }));
  });
}

describe("cmd against a core of another protocol", () => {
  it("explains and exits 2", async () => {
    const sock = await fakeCore({ protocol: PROTOCOL + 1, app: "9.9.9" });
    const r = await cli(sock, "ls", "--json");
    expect(r.code).toBe(2);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(r.stderr).toContain("doesn't match the running app (cmd 9.9.9)");
    expect(r.stderr).toContain(path.join(path.dirname(sock), "bin", "cmd"));
  });

  it("talks to a core of its own protocol, and to one too old to say", async () => {
    for (const hello of [{ protocol: PROTOCOL }, {}]) {
      const r = await cli(await fakeCore(hello), "ls", "--json");
      expect(r.stderr).toBe("");
      expect(r.code).toBe(0);
    }
  });

  it("says nothing without a hello, and names a core built from source", () => {
    expect(skewMessage(null)).toBeNull();
    expect(skewMessage({ pid: 1, socket: "", build: "", protocol: PROTOCOL + 1, app: "source" })).toMatch(/built from source.*Update cmd/);
  });
});
