// Search's methods (search.*, docs/33): sessions and history from the log, files in a workspace.

import type { CoreContext } from "../kernel/context.ts";
import { slice } from "../kernel/handlers.ts";

export const searchHandlers = (core: CoreContext) =>
  slice({
    "search.query": (p) => core.search.view.search(p.text, p.limit),
    "search.status": () => core.search.status(),
    "search.files": async (p) => {
      const root = core.search.root(p.workspaceId ?? null, p.cwd ?? null);
      return { root, hits: root ? await core.search.files.search(root, p.text, { limit: p.limit, part: p.part }) : [] };
    },
    "search.history": (p) => core.search.view.history(p.text, { workspaceId: p.workspaceId ?? null, limit: p.limit }),
    "search.reindex": () => (core.search.reindex(), null),
  });
