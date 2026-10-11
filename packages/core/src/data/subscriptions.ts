// Live queries (docs/28): a client's data.subscribe and data.subscribeView. New or changed
// events and view rows are matched against every subscription and sent a few at a time (one
// data.changed or view.changed per subscription); a view subscription whose rows the
// workspaces changed under it gets its whole result again (reset).

import type { CoreEvent, DataEvent, DataQuery, SessionInfo, TurnRow, ViewQuery } from "@cmd/protocol";
import type { Connection } from "../kernel/connection.ts";
import type { CoreContext } from "../kernel/context.ts";
import { matchesQuery } from "./match.ts";
import { projectIdOf } from "./project.ts";
import type { ActivityView } from "./views/activity.ts";

/** Events one data.changed carries; more at once (an import, a transcript chunk) sends the query's result again, marked truncated. */
const MAX_CHANGED = 500;

type Row = TurnRow | SessionInfo;
type SubsCore = Pick<CoreContext, "data" | "sessions" | "agents" | "workspaces" | "server">;

/** Whether a view row answers a view query. */
export function viewMatches(q: ViewQuery, r: Row, workspaceOf: (cwd: string | null) => string): boolean {
  if (q.workspaceId && workspaceOf(r.cwd) !== q.workspaceId) return false;
  if ("key" in r) {
    if (q.sessionId && r.key !== q.sessionId) return false;
    if (q.projectId && r.projectId !== q.projectId) return false;
    if (q.since && (r.updated ?? 0) < q.since) return false;
    return true;
  }
  if (q.agentId && r.agentId !== q.agentId) return false;
  if (q.sessionId && `${r.agentKind}:${r.sessionId}` !== q.sessionId) return false;
  if (q.projectId && projectIdOf(r.cwd) !== q.projectId) return false;
  if (q.since && r.startedAt < q.since) return false;
  return true;
}

export class Subscriptions {
  #core: SubsCore;
  /** data.subscribe subscriptions per connection: id → query; events that answer one are sent as data.changed, a few at a time. */
  #dataSubs = new Map<Connection, Map<string, DataQuery>>();
  #dataPending = new Map<Connection, Map<string, DataEvent[]>>();
  #dataFlush: ReturnType<typeof setTimeout> | null = null;
  /** data.subscribeView subscriptions per connection, and the changed rows waiting to go (by row key). */
  #viewSubs = new Map<Connection, Map<string, ViewQuery>>();
  #viewPending = new Map<Connection, Map<string, Map<string, Row>>>();
  #viewFlush: ReturnType<typeof setTimeout> | null = null;

  constructor(core: SubsCore) {
    this.#core = core;
  }

  addData(conn: Connection, id: string, q: DataQuery): void {
    const subs = this.#dataSubs.get(conn) ?? new Map<string, DataQuery>();
    subs.set(id, q);
    this.#dataSubs.set(conn, subs);
  }

  addView(conn: Connection, id: string, q: ViewQuery): void {
    const subs = this.#viewSubs.get(conn) ?? new Map<string, ViewQuery>();
    subs.set(id, q);
    this.#viewSubs.set(conn, subs);
  }

  remove(conn: Connection, id: string): void {
    this.#dataSubs.get(conn)?.delete(id);
    this.#viewSubs.get(conn)?.delete(id);
  }

  closed(conn: Connection): void {
    this.#dataSubs.delete(conn);
    this.#dataPending.delete(conn);
    this.#viewSubs.delete(conn);
    this.#viewPending.delete(conn);
  }

  /** New or updated events against every subscription; what matches is sent a few at a time, as one data.changed per subscription. */
  dataChanged(events: DataEvent[]): void {
    if (!this.#dataSubs.size) return;
    // Full-text matches once per batch and expression, not one query per event and subscription.
    const matched = new Map<string, Set<number>>();
    const seqs = events.map((e) => e.seq);
    const text = (seq: number, expr: string) => {
      let m = matched.get(expr);
      if (!m) matched.set(expr, (m = this.#core.data.textMatching(seqs, expr)));
      return m.has(seq);
    };
    for (const [conn, subs] of this.#dataSubs) {
      for (const [id, q] of subs) {
        const hits = events.filter((e) => matchesQuery(q, e, text));
        if (!hits.length) continue;
        let pending = this.#dataPending.get(conn);
        if (!pending) this.#dataPending.set(conn, (pending = new Map()));
        const list = pending.get(id);
        if (list) for (const e of hits) list.push(e);
        else pending.set(id, hits);
      }
    }
    if (this.#dataPending.size && !this.#dataFlush) {
      this.#dataFlush = setTimeout(() => {
        this.#dataFlush = null;
        for (const [conn, pending] of this.#dataPending) {
          for (const [id, evs] of pending) {
            if (evs.length <= MAX_CHANGED) this.#core.server.send(conn, { type: "data.changed", id, events: evs } satisfies CoreEvent);
            else {
              // More than one message carries: the query's result again, and a follower reads the rest by seq.
              const q = this.#dataSubs.get(conn)?.get(id);
              if (q) this.#core.server.send(conn, { type: "data.changed", id, events: this.#core.data.query(q), reset: true, truncated: true } satisfies CoreEvent);
            }
          }
        }
        this.#dataPending.clear();
      }, 50);
      this.#dataFlush.unref?.();
    }
  }

  /** Events were forgotten: every data subscription gets its whole result again (reset), with their seqs when known. */
  dataRemoved(seqs?: number[]): void {
    for (const [conn, subs] of this.#dataSubs) {
      for (const [id, q] of subs) {
        this.#dataPending.get(conn)?.delete(id);
        this.#core.server.send(conn, { type: "data.changed", id, events: this.#core.data.query(q), reset: true, ...(seqs ? { removed: seqs } : {}) });
      }
    }
  }

  /** A view's rows for a query: turns oldest first, sessions newest first. */
  rows(q: ViewQuery): Row[] {
    const { sessions, agents, workspaces } = this.#core;
    const limit = Math.min(q.limit ?? 50, 1000);
    if (q.view === "sessions") return sessions.list(q, q.workspaceId ? (r) => workspaces.of(r.cwd) === q.workspaceId : undefined);
    const since = q.since ?? Date.now() - 7 * 86400_000;
    const rows = q.agentId && !q.since ? agents.activity.turns(q.agentId, limit).map((t) => ({ ...t, cwd: null })) : agents.activity.turnsSince(since).map(({ turn, cwd }) => ({ ...turn, cwd }));
    return rows.filter((r) => viewMatches(q, r, (cwd) => workspaces.of(cwd))).slice(-limit);
  }

  /** A changed view row against every view subscription; what matches goes out in one view.changed per subscription. */
  viewChanged(view: "turns" | "sessions", rows: Row[]): void {
    if (!this.#viewSubs.size) return;
    for (const [conn, subs] of this.#viewSubs) {
      for (const [id, q] of subs) {
        if (q.view !== view) continue;
        for (const r of rows) {
          if (!viewMatches(q, r, (cwd) => this.#core.workspaces.of(cwd))) continue;
          let pending = this.#viewPending.get(conn);
          if (!pending) this.#viewPending.set(conn, (pending = new Map()));
          let m = pending.get(id);
          if (!m) pending.set(id, (m = new Map()));
          m.set("key" in r ? r.key : `${r.agentId}#${r.index}`, r);
        }
      }
    }
    if (this.#viewPending.size && !this.#viewFlush) {
      this.#viewFlush = setTimeout(() => {
        this.#viewFlush = null;
        for (const [conn, pending] of this.#viewPending) {
          for (const [id, m] of pending) {
            const q = this.#viewSubs.get(conn)?.get(id);
            if (q) this.#core.server.send(conn, { type: "view.changed", id, view: q.view, rows: [...m.values()] });
          }
        }
        this.#viewPending.clear();
      }, 50);
      this.#viewFlush.unref?.();
    }
  }

  /** The view subscriptions `pick` names get their query's whole result again, replacing theirs (view.changed with reset). */
  reset(pick: (q: ViewQuery) => boolean): void {
    for (const [conn, subs] of this.#viewSubs) {
      for (const [id, q] of subs) {
        if (!pick(q)) continue;
        this.#viewPending.get(conn)?.delete(id);
        this.#core.server.send(conn, { type: "view.changed", id, view: q.view, rows: this.rows(q), reset: true });
      }
    }
  }

  dispose(): void {
    if (this.#dataFlush) clearTimeout(this.#dataFlush);
    if (this.#viewFlush) clearTimeout(this.#viewFlush);
  }
}

/** The subscriptions (`core.subscriptions`), fed by the log, the views and the workspaces. */
export function createSubscriptions(core: SubsCore, activity: ActivityView): Subscriptions {
  const subs = new Subscriptions(core);
  core.data.on("recorded", (e) => subs.dataChanged([e]));
  core.data.on("batch", (events) => subs.dataChanged(events));
  core.data.on("removed", ({ seqs }) => subs.dataRemoved(seqs));
  core.sessions.onChange((rows) => subs.viewChanged("sessions", rows));
  core.sessions.onReset(() => subs.reset((q) => q.view === "sessions"));
  activity.onTurn((t, cwd) => subs.viewChanged("turns", [{ ...t, cwd }]));
  core.server.onClosed((conn) => subs.closed(conn));
  return subs;
}

/** A workspace opened or closed moves folders between workspaces: live queries by workspace start over. */
export function resetOnRoots(core: Pick<CoreContext, "workspaces" | "subscriptions">): void {
  let roots = "";
  const changed = () => {
    const now = core.workspaces.list().map((s) => s.root).sort().join("\n");
    if (now !== roots) (roots = now), core.subscriptions.reset((q) => !!q.workspaceId);
  };
  changed();
  core.workspaces.on("updated", changed);
  core.workspaces.on("removed", changed);
}
