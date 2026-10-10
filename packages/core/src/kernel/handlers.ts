// The RPC handler map's type, and the slice of it a feature declares in its own folder
// (kernel/features.ts). Core.handlers merges the slices into one map of type Handlers, so tsc
// still fails on a method nobody handles.

import type { Method, Params, Result } from "@cmd/protocol";

export type Handlers = { [M in Method]: (params: Params<M>) => Result<M> | Promise<Result<M>> };
/** The handlers of some methods, e.g. a feature's: HandlerSlice<keyof JournalMethods>. */
export type HandlerSlice<K extends Method> = Pick<Handlers, K>;
