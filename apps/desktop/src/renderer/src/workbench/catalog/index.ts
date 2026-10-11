// The catalog and story loaders from virtual:workbench-catalog (plugin.ts), typed.
import * as served from "virtual:workbench-catalog";
import type { Catalog } from "./types.ts";

export const catalog = served.catalog as Catalog;
/** A story file's module: each export that is a component is a variant; `args` fills in props. */
export const loaders = served.loaders as Record<string, () => Promise<Record<string, unknown> & { args?: Record<string, unknown> }>>;
export type * from "./types.ts";
