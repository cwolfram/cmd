// Closed windows, to reopen where they were (⇧⌘T, the Navigator's Recent). A record
// keeps the window's id, so its place in the layout (workspace.view) and its UI
// state still fit when it comes back. A terminal can't keep its process: it keeps
// its folder, last screen and shell history, and comes back as a new shell that
// runs nothing. The newest few per workspace are kept, in the store.

import { EventEmitter } from "node:events";
import type { AppWindow, ClosedWindow, WindowId, WorkspaceId } from "@cmd/protocol";
import type { Store } from "../store.ts";

/** Closed windows kept per workspace; older ones are forgotten. */
export const CLOSED_PER_WORKSPACE = 20;

export interface ClosedRecord {
  id: WindowId;
  workspaceId: WorkspaceId;
  kind: string;
  title: string;
  closedAt: number;
  /** Other windows: the window as it was. */
  window: AppWindow | null;
  /** Terminals: what a new shell needs to look like the old one. */
  terminal: {
    cwd: string;
    cols: number;
    rows: number;
    createdAt: number;
    muted: boolean;
    /** What was running when it closed (shown, never run). */
    command: string | null;
    screen: { data: string; savedAt: number } | null;
  } | null;
}

export class ClosedWindows extends EventEmitter<{ changed: []; forgotten: [ClosedRecord] }> {
  /** Oldest first. */
  #records = new Map<WindowId, ClosedRecord>();
  #store: Store | null;

  constructor(store: Store | null) {
    super();
    this.#store = store;
    for (const r of store?.closedWindows() ?? []) this.#records.set(r.id, r);
  }

  /** Newest first. */
  list(workspaceId?: WorkspaceId): ClosedWindow[] {
    const out: ClosedWindow[] = [];
    for (const r of [...this.#records.values()].reverse()) {
      if (workspaceId && r.workspaceId !== workspaceId) continue;
      out.push({ id: r.id, workspaceId: r.workspaceId, kind: r.kind, title: r.title, closedAt: r.closedAt, ...(r.terminal ? { cwd: r.terminal.cwd } : {}) });
    }
    return out;
  }

  get(id: WindowId): ClosedRecord | undefined {
    return this.#records.get(id);
  }

  /** The workspace's newest. */
  latest(workspaceId: WorkspaceId): ClosedRecord | undefined {
    return [...this.#records.values()].reverse().find((r) => r.workspaceId === workspaceId);
  }

  add(r: ClosedRecord): void {
    this.#records.delete(r.id);
    this.#records.set(r.id, r);
    this.#store?.saveClosedWindow(r);
    const mine = [...this.#records.values()].filter((x) => x.workspaceId === r.workspaceId);
    for (const old of mine.slice(0, Math.max(0, mine.length - CLOSED_PER_WORKSPACE))) this.emit("forgotten", this.#drop(old.id)!);
    this.emit("changed");
  }

  /** Off the list, to reopen it: what it kept stays. */
  take(id: WindowId): ClosedRecord | undefined {
    const r = this.#drop(id);
    if (r) this.emit("changed");
    return r;
  }

  /** Off the list for good: `forgotten` lets its owners drop what they kept for it. */
  forget(id: WindowId): void {
    const r = this.take(id);
    if (r) this.emit("forgotten", r);
  }

  #drop(id: WindowId): ClosedRecord | undefined {
    const r = this.#records.get(id);
    if (!r) return undefined;
    this.#records.delete(id);
    this.#store?.deleteClosedWindow(id);
    return r;
  }
}
