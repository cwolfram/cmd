// Local writes to workspace views (layout, selection) on their way to the core.
// A write applies locally at once and stays over what the core sends until the
// workspace.update call that carries it is answered. The core broadcasts the
// change before it answers (one socket, in order), so from then on what it sends
// includes the write. A value from the core that merely equals a write proves
// nothing: it can be the echo of an older write (A, B, back to A while both are in
// flight), and taking it as the answer let B's echo undo the last A for good.

// A call that fails (the core restarting, the socket gone) leaves its writes to be
// sent again after the reconnect (unsent()), a few times at most, so a core that
// keeps refusing one can't keep it over the core's view forever.

type Write = { value: unknown; sent: boolean; tries: number };

/** Failed sends of one write before it is dropped. */
const MAX_TRIES = 3;

export class PendingViews {
  #writes = new Map<string, Map<string, Write>>();

  /** A local write of one key. */
  set(workspaceId: string, key: string, value: unknown): void {
    if (!this.#writes.has(workspaceId)) this.#writes.set(workspaceId, new Map());
    this.#writes.get(workspaceId)!.set(key, { value, sent: false, tries: 0 });
  }

  /** The view the UI should show: the core's, with the writes it hasn't answered yet over it. */
  over(workspaceId: string, view: Record<string, unknown>): Record<string, unknown> {
    const w = this.#writes.get(workspaceId);
    if (!w?.size) return view;
    const out = { ...view };
    for (const [k, { value }] of w) out[k] = value;
    return out;
  }

  /**
   * The writes not sent yet, to send now (null: nothing new). Call settle once the
   * core answered: each write still the latest of its key stops overriding. Call
   * failed when the call failed: they wait to be sent again (unsent), or go after MAX_TRIES.
   */
  take(workspaceId: string): { view: Record<string, unknown>; settle: () => void; failed: () => void } | null {
    const w = this.#writes.get(workspaceId);
    const batch = [...(w ?? [])].filter(([, write]) => !write.sent);
    if (!w || !batch.length) return null;
    for (const [, write] of batch) write.sent = true;
    return {
      view: Object.fromEntries(batch.map(([k, { value }]) => [k, value ?? null])),
      settle: () => {
        for (const [k, write] of batch) if (w.get(k) === write) w.delete(k);
      },
      failed: () => {
        for (const [k, write] of batch) {
          if (w.get(k) !== write) continue; // a newer write of the key is on its way
          if (++write.tries >= MAX_TRIES) w.delete(k);
          else write.sent = false;
        }
      },
    };
  }

  /** Workspaces with writes waiting to be sent (again, after a failed call). */
  unsent(): string[] {
    return [...this.#writes].filter(([, w]) => [...w.values()].some((write) => !write.sent)).map(([id]) => id);
  }

  /** Forget a workspace's writes (it's gone). */
  drop(workspaceId: string): void {
    this.#writes.delete(workspaceId);
  }
}
