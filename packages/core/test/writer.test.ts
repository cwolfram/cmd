// A connection's writer (kernel/writer.ts): output goes straight out while the
// transport keeps up, waits merged per pane while it doesn't, and past
// MAX_PENDING becomes a pane.resync; a client that never reads is cut.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreEvent } from "@cmd/protocol";
import { ConnectionWriter, eventLine } from "../src/kernel/writer.ts";

/** A transport that reports itself backed up while `full`, and counts what it holds. */
function transport() {
  const t = { lines: [] as string[], full: false, held: 0, closed: null as string | null };
  return {
    t,
    write: (line: string) => (t.lines.push(line), (t.held += line.length), !t.full),
    buffered: () => t.held,
    close: (reason: string) => void (t.closed = reason),
  };
}
const out = (paneId: string, data: string, seq?: number): [CoreEvent, string] => {
  const e: CoreEvent = { type: "pane.output", paneId, data, seq };
  return [e, eventLine(e)];
};
const events = (lines: string[]) => lines.map((l) => JSON.parse(l).params as CoreEvent);

afterEach(() => vi.useRealTimers());

describe("ConnectionWriter", () => {
  it("writes output at once while the transport keeps up", () => {
    const tr = transport();
    const w = new ConnectionWriter(tr);
    w.event(...out("a", "x", 1));
    w.event(...out("a", "y", 2));
    expect(events(tr.t.lines).map((e) => e.type === "pane.output" && e.data)).toEqual(["x", "y"]);
  });

  it("holds output merged per pane while backed up, and sends it on drain", () => {
    const tr = transport();
    const w = new ConnectionWriter(tr);
    tr.t.full = true;
    w.event(...out("a", "1", 1)); // written: the transport says it's full now
    w.event(...out("a", "2", 2));
    w.event(...out("b", "3", 1));
    w.event(...out("a", "4", 3));
    expect(tr.t.lines).toHaveLength(1);
    tr.t.full = false;
    tr.t.held = 0;
    w.drain();
    expect(events(tr.t.lines.slice(1))).toEqual([
      { type: "pane.output", paneId: "a", data: "24", seq: 3 },
      { type: "pane.output", paneId: "b", data: "3", seq: 1 },
    ]);
  });

  it("drops what waits past maxPending and asks for a resync of each pane it was for", () => {
    const tr = transport();
    const w = new ConnectionWriter(tr, { maxPending: 10 });
    tr.t.full = true;
    w.event(...out("a", "first"));
    w.event(...out("a", "123456"));
    w.event(...out("b", "123456"));
    expect(events(tr.t.lines.slice(1))).toEqual([
      { type: "pane.resync", paneId: "a" },
      { type: "pane.resync", paneId: "b" },
    ]);
  });

  it("resyncs instead of flushing into a transport still holding more than maxPending", () => {
    const tr = transport();
    const w = new ConnectionWriter(tr, { maxPending: 10 });
    tr.t.full = true;
    w.event(...out("a", "a long first line"));
    w.event(...out("a", "x"));
    tr.t.full = false;
    w.drain();
    expect(events(tr.t.lines.slice(1))).toEqual([{ type: "pane.resync", paneId: "a" }]);
  });

  it("keeps output ahead of the events after it", () => {
    const tr = transport();
    const w = new ConnectionWriter(tr);
    tr.t.full = true;
    w.event(...out("a", "1"));
    w.event(...out("a", "2"));
    const removed: CoreEvent = { type: "pane.removed", paneId: "a" };
    w.event(removed, eventLine(removed));
    expect(events(tr.t.lines).map((e) => e.type)).toEqual(["pane.output", "pane.output", "pane.removed"]);
  });

  it("cuts a client with more than maxBuffered unread", () => {
    const tr = transport();
    const w = new ConnectionWriter(tr, { maxBuffered: 100 });
    tr.t.full = true;
    const e: CoreEvent = { type: "pane.removed", paneId: "a" };
    for (let i = 0; i < 5 && !tr.t.closed; i++) w.event(e, eventLine(e));
    expect(tr.t.closed).toMatch(/unread/);
    const n = tr.t.lines.length;
    w.event(e, eventLine(e));
    expect(tr.t.lines).toHaveLength(n);
  });

  it("merges output for coalesceMs when asked (a remote session)", () => {
    vi.useFakeTimers();
    const tr = transport();
    const w = new ConnectionWriter(tr, { coalesceMs: 30 });
    w.event(...out("a", "1", 1));
    w.event(...out("a", "2", 2));
    expect(tr.t.lines).toEqual([]);
    vi.advanceTimersByTime(30);
    expect(events(tr.t.lines)).toEqual([{ type: "pane.output", paneId: "a", data: "12", seq: 2 }]);
  });
});
