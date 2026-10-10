// The event log's methods (data.*, docs/28): queries, live subscriptions, what clients record,
// forgetting and rebuilding.

import { randomUUID } from "node:crypto";
import type { CoreContext } from "../kernel/context.ts";
import { IN_CORE, slice } from "../kernel/handlers.ts";

export const dataHandlers = (core: CoreContext) =>
  slice({
    "data.query": (p) => core.data.query(p.query),
    "data.stats": () => core.data.stats(),
    "data.explain": () => core.data.explain(),
    "data.record": (p) => {
      if (!/^(user\.|note$)/.test(p.event.type)) throw new Error("clients record user actions and notes; the core records the rest");
      const e = core.data.record({ ...p.event, source: p.event.source || "client" });
      return e ? { seq: e.seq } : null;
    },
    "data.import": (p) => ({ imported: core.data.recordAll(p.events) }),
    "data.subscribe": (p, { conn } = IN_CORE) => {
      const id = randomUUID();
      if (conn) core.subscriptions.addData(conn, id, p.query);
      return { id, events: core.data.query(p.query) };
    },
    "data.view": (p) => core.subscriptions.rows(p.query),
    "data.subscribeView": (p, { conn } = IN_CORE) => {
      const id = randomUUID();
      if (conn) core.subscriptions.addView(conn, id, p.query);
      return { id, rows: core.subscriptions.rows(p.query) };
    },
    "data.unsubscribe": (p, { conn } = IN_CORE) => (conn && core.subscriptions.remove(conn, p.id), null),
    "data.forget": (p) => ({ events: core.data.forget(p) }),
    "data.applyRules": async () => ({ events: await core.data.applyRules() }),
    "data.rebuild": async (p) => (p.view === "turns" ? { rows: (await core.agents.activity.rebuild()).turns } : { rows: (await core.sessions.rebuild(), core.sessions.counts().sessions) }),
    "data.entities": (p) => {
      const list = p.id ? [core.data.store.entityOf(p.kind, p.id)].filter((e) => !!e) : core.data.store.entities(p.kind).slice(0, Math.min(p.limit ?? 50, 1000)).map((e) => ({ kind: p.kind, ...e }));
      return list.map((e) => ({ ...e!, links: core.data.store.linksOf(p.kind, e!.id) }));
    },
  });
