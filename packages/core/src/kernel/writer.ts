// One connection's way out (a socket client's or a paired device's). Replies and
// events go straight to the transport while it keeps up. While it doesn't (the
// socket's buffer is full: a paused renderer, a `cmd events` piped into something
// slow), a pane's output waits, merged per pane, and past MAX_PENDING it is dropped
// for a pane.resync: the client takes a snapshot instead. So a client that stops
// reading costs the core a bounded buffer, not the whole stream, and one that keeps
// growing it anyway (MAX_BUFFERED, events other than output) is cut and reconnects.

import type { CoreEvent } from "@cmd/protocol";

/** Output waiting beyond this is dropped (the client resyncs from a snapshot). */
export const MAX_PENDING = 1024 * 1024;
/** A client with more than this unread is cut (UTF-16 units written and not yet sent). */
export const MAX_BUFFERED = 64 * 1024 * 1024;

export interface WriterTransport {
  /** Write one line; false when the transport is backed up (call drain() once it isn't). */
  write(line: string): boolean;
  /** Written and not yet sent. */
  buffered(): number;
  /** Cut the client; `reason` is for the log. */
  close(reason: string): void;
}

export interface WriterOptions {
  /** Merge a pane's output for this long before sending it; 0 sends it at once while the transport keeps up. */
  coalesceMs?: number;
  maxPending?: number;
  maxBuffered?: number;
}

export const eventLine = (e: CoreEvent) => JSON.stringify({ jsonrpc: "2.0", method: "event", params: e }) + "\n";

export class ConnectionWriter {
  #t: WriterTransport;
  #coalesceMs: number;
  #maxPending: number;
  #maxBuffered: number;
  /** Output waiting, per pane in arrival order, with the seq of its end. */
  #pending = new Map<string, { data: string; seq?: number }>();
  #pendingBytes = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #blocked = false;
  #closed = false;

  constructor(t: WriterTransport, o: WriterOptions = {}) {
    this.#t = t;
    this.#coalesceMs = o.coalesceMs ?? 0;
    this.#maxPending = o.maxPending ?? MAX_PENDING;
    this.#maxBuffered = o.maxBuffered ?? MAX_BUFFERED;
  }

  /** Output waiting to go (UTF-16 units). */
  get pending(): number {
    return this.#pendingBytes;
  }

  /** A reply: straight out (replies and events are joined by seq, not by order). */
  send(line: string): void {
    this.#write(line);
  }

  event(e: CoreEvent, line: string): void {
    if (e.type !== "pane.output") {
      this.#flush(); // keep output ahead of what follows it
      this.#write(line);
      return;
    }
    if (!this.#coalesceMs && !this.#blocked && !this.#pending.size) return this.#write(line);
    this.#pending.set(e.paneId, { data: (this.#pending.get(e.paneId)?.data ?? "") + e.data, seq: e.seq });
    this.#pendingBytes += e.data.length;
    if (this.#pendingBytes > this.#maxPending) return this.#resync();
    if (!this.#blocked) this.#timer ??= setTimeout(() => this.#flush(), this.#coalesceMs);
  }

  /** The transport took what was written: send what waited. */
  drain(): void {
    this.#blocked = false;
    this.#flush();
  }

  dispose(): void {
    this.#closed = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#pending.clear();
  }

  /** Drop what waits; each pane it was for starts over from a snapshot. */
  #resync(): void {
    const panes = [...this.#pending.keys()];
    this.#clear();
    for (const paneId of panes) this.#write(eventLine({ type: "pane.resync", paneId }));
  }

  #flush(): void {
    if (!this.#pending.size) return this.#clear();
    // Still more unsent than we'd hold: what waits would only grow the transport's buffer.
    if (this.#t.buffered() > this.#maxPending) return this.#resync();
    const out = [...this.#pending];
    this.#clear();
    for (const [paneId, { data, seq }] of out) this.#write(eventLine({ type: "pane.output", paneId, data, seq }));
  }

  #clear(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#pending.clear();
    this.#pendingBytes = 0;
  }

  #write(line: string): void {
    if (this.#closed) return;
    if (!this.#t.write(line)) this.#blocked = true;
    if (this.#t.buffered() > this.#maxBuffered) {
      this.dispose();
      this.#t.close(`over ${Math.round(this.#maxBuffered / 1024 / 1024)} MB unread`);
    }
  }
}
