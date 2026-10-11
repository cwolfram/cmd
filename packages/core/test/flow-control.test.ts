// A client that stops reading while a terminal prints a lot (AR1-02-01): the core
// holds a bounded amount for it and, once it reads again, tells it to resync
// that terminal from a snapshot instead of sending everything it missed.

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lineSplitter, type CoreEvent } from "@cmd/protocol";
import { Core } from "../src/kernel/core.ts";
import { MAX_PENDING } from "../src/kernel/writer.ts";
import { fakeFactory } from "./fake-pty.ts";
import { rmTemp } from "./tmp.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmd-flow-"));
const socketPath = path.join(dir, "core.sock");
const f = fakeFactory();
let core: Core;

beforeAll(async () => {
  core = new Core({ socketPath, dbPath: null, settingsPath: null, terminals: f.factory, pollMs: 0 });
  await core.listen();
});
afterAll(async () => {
  await core.close();
  rmTemp(dir);
});

describe("a client that stops reading", () => {
  it("costs the core a bounded buffer and gets a resync, not the backlog", async () => {
    const pane = core.panes.create({ cwd: dir });
    const pty = f.ptys.at(-1)!;
    const sock = net.createConnection(socketPath);
    sock.setEncoding("utf8");
    const got: CoreEvent[] = [];
    let read = 0;
    sock.on("data", (d: string) => (read += d.length));
    sock.on("data", lineSplitter((l) => {
      const m = JSON.parse(l);
      if (m.method === "event") got.push(m.params);
    }));
    await new Promise((r) => sock.once("connect", r));
    sock.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "events.subscribe", params: {} }) + "\n");
    await new Promise<void>((r) => {
      const check = () => (got.length || read > 0 ? r() : setTimeout(check, 5));
      check();
    });
    // It stops reading; the terminal prints 32 MB.
    sock.pause();
    const line = "y\r\n".repeat(16 * 1024);
    const total = 32 * 1024 * 1024;
    for (let sent = 0; sent < total; sent += line.length) {
      pty.output(line);
      if (sent % (1024 * 1024) < line.length) await new Promise((r) => setImmediate(r));
    }
    const at = read;
    sock.resume();
    await new Promise<void>((r) => {
      const check = () => (got.some((e) => e.type === "pane.resync") ? r() : setTimeout(check, 10));
      check();
    });
    await new Promise((r) => setTimeout(r, 200));
    const output = got.filter((e): e is Extract<CoreEvent, { type: "pane.output" }> => e.type === "pane.output" && e.paneId === pane.id);
    const shown = output.reduce((n, e) => n + e.data.length, 0);
    expect(got).toContainEqual({ type: "pane.resync", paneId: pane.id });
    // What it read after it came back: what the socket held, MAX_PENDING at most of it waiting in the core, never the backlog.
    expect(read - at).toBeLessThan(total / 4);
    expect(shown).toBeLessThan(total / 4);
    expect(MAX_PENDING).toBeLessThan(total / 4);
    sock.destroy();
  }, 60_000);
});
