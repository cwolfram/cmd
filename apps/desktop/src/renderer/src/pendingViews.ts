// Local writes to workspace views (layout, selection) on their way to the core.
// A write applies locally at once and stays over what the core sends until the
// workspace.update call that carries it is answered. The core broadcasts the
// change before it answers (one socket, in order), so from then on what it sends
// includes the write. A value from the core that merely equals a write proves
// nothing: it can be the echo of an older write (A, B, back to A while both are in
// flight), and taking it as the answer let B's echo undo the last A for good.

type Write = { value: unknown; sent: boolean };

export class PendingViews {
  #writes = new Map<string, Map<string, Write>>();

  /** A local write of one key. */
  set(workspaceId: string, key: string, value: unknown): void {
    if (!this.#writes.has(workspaceId)) this.#writes.set(workspaceId, new Map());
    this.#writes.get(workspaceId)!.set(key, { value, sent: false });
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
   * core answered or failed: each write still the latest of its key stops overriding.
   */
  take(workspaceId: string): { view: Record<string, unknown>; settle: () => void } | null {
    const w = this.#writes.get(workspaceId);
    const batch = [...(w ?? [])].filter(([, write]) => !write.sent);
    if (!w || !batch.length) return null;
    for (const [, write] of batch) write.sent = true;
    return {
      view: Object.fromEntries(batch.map(([k, { value }]) => [k, value ?? null])),
      settle: () => {
        for (const [k, write] of batch) if (w.get(k) === write) w.delete(k);
      },
    };
  }
}
