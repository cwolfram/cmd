// Stats as one feature (docs/49-stats.md; kernel/features.ts): the service with the built-in
// stats, its RPC methods (StatsMethods, protocol stats.ts), the startup job that starts
// listening to the log and builds what isn't built, and its teardown.

import type { StatsMethods } from "@cmd/protocol";
import type { Feature } from "../kernel/features.ts";
import type { CoreContext } from "../kernel/context.ts";
import type { HandlerSlice } from "../kernel/handlers.ts";
import { BUILTIN_STATS } from "./builtin.ts";
import { StatsService, type StatsCore } from "./service.ts";

/** The service (`core.stats`). It reads nothing until start(): the core makes it before the services it reads. */
export function createStats(core: StatsCore): StatsService {
  return new StatsService(core, BUILTIN_STATS);
}

export const statsFeature = {
  id: "stats",
  handlers: (core: CoreContext): HandlerSlice<keyof StatsMethods> => ({
    "stats.catalog": () => core.stats.catalog(),
    "stats.query": (p) => core.stats.query(p),
    "stats.queryMany": (p) => core.stats.queryMany(p.queries),
    "stats.rebuild": (p) => ({ stats: core.stats.rebuild(p.stat) }),
  }),
  startup: { label: "Counting stats", run: (core: CoreContext) => core.stats.start() },
  dispose: (core: CoreContext) => core.stats.dispose(),
} satisfies Feature;
