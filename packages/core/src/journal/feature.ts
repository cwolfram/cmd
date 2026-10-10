// The journal as one feature (docs/23-journal.md; kernel/features.ts): its service, built
// from the core's, its RPC methods, its startup job and its window type, all declared here, so
// the core and the lists of methods and window types only name it.

import type { JournalMethods, WorkspaceId } from "@cmd/protocol";
import type { Core } from "../kernel/core.ts";
import type { Feature } from "../kernel/features.ts";
import type { HandlerSlice } from "../kernel/handlers.ts";
import { scopedWidget } from "../windows/scoped.ts";
import { JournalService, SYNC_FRESH_MS } from "./service.ts";
import { JournalStore } from "./store.ts";

/** The Journal widget (registered with the other built-in types, windows/builtin.ts, so it keeps its place in the Widget Library). */
export const journalType = scopedWidget("journal", "Journal", "book", "What happened, a few lines a day: releases, features, fixes and investigations, from your agents, terminals and git.");

/** The journal's service, from the core's (`core.journal`). */
export function createJournal(core: Core): JournalService {
  return new JournalService({
    store: new JournalStore(core.store.db, { recordedBy: core.agents.activity.recordedBy, data: core.data, turns: (since) => core.agents.activity.turnsSince(since), sessions: (since) => core.sessions.sessionsSince(since), workspaces: () => core.workspaces.list() }),
    workspaces: () => core.workspaces.list(),
    agentWorkspace: (id) => core.agents.get(id)?.workspaceId ?? null,
    ai: {
      object: (o) => core.ai.object(o),
      modelName: () => {
        const p = core.ai.provider();
        return p ? (core.ai.status().providers[p].models?.smart.name ?? null) : null;
      },
    },
    pace: core.scheduler,
  });
}

export const journalFeature = {
  id: "journal",
  handlers: (core: Core): HandlerSlice<keyof JournalMethods> => ({
    "journal.days": (p) => core.journal.days(journalScope(p), Math.min(p.count ?? 7, 60), p.write),
    "journal.day": async (p) => (await core.journal.sync(p.write === "force" ? 0 : SYNC_FRESH_MS), core.journal.day(journalScope(p), core.journal.dayOf(p.date), p.write)),
    "journal.week": (p) => core.journal.week(journalScope(p), p.date, p.write),
    "journal.history": (p) => core.journal.store.history(journalScope(p), core.journal.dayOf(p.date)),
    "journal.events": (p) => core.journal.store.events(p),
    "journal.threads": async (p) => {
      await core.journal.sync(SYNC_FRESH_MS);
      const t = core.journal.threads(journalScope(p), core.journal.dayOf(p.date));
      return { threads: t.threads, digest: t.digest.text };
    },
    "journal.note": (p) => {
      const pane = p.paneId ? core.panes.get(p.paneId) : undefined;
      const agent = pane?.agentId ? core.agents.get(pane.agentId) : null;
      const session = agent ? (agent.native.claudeSessionId ?? agent.native.codexThreadId ?? null) : null;
      return { id: core.journal.note(p.text, { by: agent ? "agent" : "user", agentSession: session, workspaceId: p.workspaceId ?? pane?.workspaceId ?? null, cwd: pane?.cwd ?? null }) };
    },
    "journal.sync": async () => (await core.journal.sync(), null),
  }),
  startup: {
    label: "Starting the journal",
    run(core: Core) {
      core.journal.start();
      // A workspace opened on a folder: what git and imports recorded there before belongs to it too.
      core.workspaces.on("updated", () => void core.journal.assignWorkspaces());
    },
  },
  dispose: (core: Core) => core.journal.dispose(),
} satisfies Feature;

/** A journal method's scope: a workspace, else the one asked for, else everything. */
function journalScope(p: { workspaceId?: WorkspaceId; scope?: string }): string {
  return p.workspaceId ? `workspace:${p.workspaceId}` : (p.scope ?? "all");
}
