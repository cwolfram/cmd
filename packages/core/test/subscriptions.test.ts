// Live queries on their own (data/subscriptions.ts), without a Core: matching events go out a
// few at a time per subscription, a reset sends a view's whole result, and a closed connection
// gets nothing more. Plus fs.watch: a client's watch goes when the client does.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreEvent, DataEvent, SessionInfo } from "@cmd/protocol";
import { connect } from "@cmd/protocol/node";
import { Subscriptions } from "../src/data/subscriptions.ts";
import type { Connection } from "../src/kernel/connection.ts";
import { Core } from "../src/kernel/core.ts";
import { fakeFactory } from "./fake-pty.ts";
import { rmTemp } from "./tmp.ts";

const event = (seq: number, type: string): DataEvent => ({ seq, id: `e${seq}`, at: 1000 + seq, type, source: "test", data: {} }) as unknown as DataEvent;
const session = (key: string): SessionInfo => ({ key, cwd: "/w", updated: 2000 }) as unknown as SessionInfo;

function setup() {
  const sent: [Connection, CoreEvent][] = [];
  const rows = [session("s1"), session("s2")];
  const subs = new Subscriptions({
    data: { textMatching: (seqs: number[]) => new Set(seqs), query: () => [event(1, "note")] } as never,
    sessions: { list: () => rows } as never,
    agents: {} as never,
    workspaces: { of: () => "w" } as never,
    server: { send: (c: Connection, e: CoreEvent) => sent.push([c, e]) } as never,
  });
  const conn = { access: "local", send: () => {}, close: () => {} } as Connection;
  return { subs, sent, conn };
}

afterEach(() => vi.useRealTimers());

describe("subscriptions", () => {
  it("say a burst too big for one message was cut, with the query's result again", () => {
    vi.useFakeTimers();
    const { subs, sent, conn } = setup();
    subs.addData(conn, "a", { types: ["note"] });
    subs.dataChanged(Array.from({ length: 600 }, (_, i) => event(i + 1, "note")));
    vi.advanceTimersByTime(60);
    expect(sent).toHaveLength(1);
    expect(sent[0]![1]).toMatchObject({ type: "data.changed", id: "a", reset: true, truncated: true, events: [{ seq: 1 }] });
  });

  it("send what matches, a few at a time, one data.changed per subscription", () => {
    vi.useFakeTimers();
    const { subs, sent, conn } = setup();
    subs.addData(conn, "a", { types: ["note"] });
    subs.addData(conn, "b", { types: ["user."] });
    subs.dataChanged([event(1, "note"), event(2, "user.look")]);
    subs.dataChanged([event(3, "note"), event(4, "git.commit")]);
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(60);
    expect(sent.map(([, e]) => e)).toEqual([
      { type: "data.changed", id: "a", events: [event(1, "note"), event(3, "note")] },
      { type: "data.changed", id: "b", events: [event(2, "user.look")] },
    ]);
  });

  it("send a view's whole result again on a reset, and nothing after the connection closed", () => {
    vi.useFakeTimers();
    const { subs, sent, conn } = setup();
    subs.addView(conn, "v", { view: "sessions", workspaceId: "w" });
    subs.reset((q) => !!q.workspaceId);
    expect(sent.map(([, e]) => e)).toEqual([{ type: "view.changed", id: "v", view: "sessions", rows: [session("s1"), session("s2")], reset: true }]);
    subs.addData(conn, "a", { types: ["note"] });
    subs.closed(conn);
    subs.dataChanged([event(5, "note")]);
    subs.viewChanged("sessions", [session("s3")]);
    vi.advanceTimersByTime(60);
    expect(sent).toHaveLength(1);
  });

  it("let go of a client's file watch when the client closes, as the core does its own on close", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmd-watch-"));
    const core = new Core({ socketPath: path.join(dir, "core.sock"), dbPath: null, settingsPath: null, terminals: fakeFactory().factory, pollMs: 0 });
    await core.listen();
    const unwatch = vi.spyOn(core.watches, "unwatch");
    const client = await connect(path.join(dir, "core.sock"));
    expect(await client.client.call("fs.watch", { path: dir })).toEqual({ watching: true });
    client.close();
    await vi.waitFor(() => expect(unwatch).toHaveBeenCalledWith(dir));
    expect(await core.call("fs.watch", { path: dir })).toEqual({ watching: true });
    const close = vi.spyOn(core.watches, "close");
    await core.close();
    expect(close).toHaveBeenCalled();
    rmTemp(dir);
  });
});
