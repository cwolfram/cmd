// The RPC handler map's type, and the slice of it each folder declares in its own handlers.ts.
// Core.handlers merges the slices into one map of type Handlers, so tsc still fails on a
// method nobody handles (and test/handlers.test.ts on one handled twice).

import type { Method, Params, Result } from "@cmd/protocol";
import type { Connection } from "./connection.ts";

/** Who called: a client's connection, or null for a call from inside the core (Core.call, tests). */
export interface Call {
  conn: Connection | null;
}

/** A call from inside the core: no connection. */
export const IN_CORE: Call = { conn: null };

/** Each method's handler; `call` is left out by callers inside the core (IN_CORE). */
export type Handlers = { [M in Method]: (params: Params<M>, call?: Call) => Result<M> | Promise<Result<M>> };
/** The handlers of some methods, e.g. a feature's: HandlerSlice<keyof JournalMethods>. */
export type HandlerSlice<K extends Method> = Pick<Handlers, K>;

/** A slice of handlers, its methods named by its keys (each handler's params typed by its method). */
export const slice = <K extends Method>(h: { [P in K]: Handlers[P] }): { [P in K]: Handlers[P] } => h;
