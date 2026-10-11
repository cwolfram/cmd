// The web client's service worker (public/sw.js), run against a stand-in for
// the worker's global scope: what a push shows, and where a tap goes.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const code = fs.readFileSync(path.join(import.meta.dirname, "../public/sw.js"), "utf8");

interface Shown {
  title: string;
  options: { body: string; tag: string; data: { mac: string | null; paneId: string | null } };
}

function worker(windows: { postMessage: (m: unknown) => void; focus: () => Promise<unknown> }[] = []) {
  const listeners = new Map<string, (e: unknown) => void>();
  const shown: Shown[] = [];
  const opened: string[] = [];
  const self = {
    location: { origin: "https://cmd.example" },
    addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, fn),
    skipWaiting: () => {},
    registration: { showNotification: async (title: string, options: Shown["options"]) => void shown.push({ title, options }) },
    clients: { matchAll: async () => windows, openWindow: async (url: string) => void opened.push(url) },
  };
  new Function("self", code)(self);
  const fire = async (type: string, e: object) => {
    let wait: Promise<unknown> = Promise.resolve();
    listeners.get(type)!({ ...e, waitUntil: (p: Promise<unknown>) => (wait = p) });
    await wait;
  };
  return { fire, shown, opened };
}

const push = (payload: unknown) => ({ data: { json: () => (typeof payload === "string" ? JSON.parse(payload) : payload) } });
const click = (data: unknown) => ({ notification: { data, close: () => {} } });

describe("service worker", () => {
  it("shows a Mac's push, one per terminal", async () => {
    const w = worker();
    await w.fire("push", push({ host: "MAC", id: "n1", title: "api · needs you", body: "Allow “pnpm test”?", paneId: "p1" }));
    expect(w.shown).toEqual([{ title: "api · needs you", options: expect.objectContaining({ body: "Allow “pnpm test”?", tag: "pane:p1", data: { mac: "MAC", paneId: "p1" } }) }]);
    await w.fire("push", push({ host: "MAC", id: "n2", title: "Build", body: "done", paneId: null }));
    expect(w.shown[1]!.options.tag).toBe("n2");
  });

  it("still shows something for a push it can't read", async () => {
    const w = worker();
    await w.fire("push", push("not json"));
    expect(w.shown).toEqual([{ title: "cmd", options: expect.objectContaining({ body: "" }) }]);
  });

  it("opens the client at that Mac and terminal on a tap", async () => {
    const w = worker();
    await w.fire("notificationclick", click({ mac: "MAC", paneId: "p1" }));
    expect(w.opened).toEqual(["https://cmd.example/?mac=MAC&pane=p1"]);
  });

  it("tells an open client instead of opening another", async () => {
    const got: unknown[] = [];
    let focused = 0;
    const w = worker([{ postMessage: (m) => got.push(m), focus: async () => focused++ }]);
    await w.fire("notificationclick", click({ mac: "MAC", paneId: "p1" }));
    expect(got).toEqual([{ type: "cmd.open", mac: "MAC", paneId: "p1" }]);
    expect(focused).toBe(1);
    expect(w.opened).toEqual([]);
  });
});
