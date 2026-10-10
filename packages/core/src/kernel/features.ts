// Features that declare themselves in their own folder (docs/architecture-review-01/17,
// AR1-17-05; AR1-16-08): each contributes its slice of the RPC handlers, a startup job and its
// teardown. Its service is a typed field of Core (core.journal), created there from the
// feature's own function; everything else comes from this list. The journal is the first.

import type { Core } from "./core.ts";
import type { Handlers } from "./handlers.ts";
import { journalFeature } from "../journal/feature.ts";

export interface Feature {
  id: string;
  /** Its methods. They are merged into Core.handlers, where a method left out fails tsc. */
  handlers(core: Core): Partial<Handlers>;
  /** Run once the core answers (docs/34): label is what the footer shows while it runs. */
  startup?: { label: string; run(core: Core): void | Promise<void> };
  dispose?(core: Core): void;
}

export const FEATURES = [journalFeature] as const satisfies readonly Feature[];

type Intersection<T> = (T extends unknown ? (x: T) => void : never) extends (x: infer I) => void ? I : never;
/** Every feature's handlers, typed as the methods they cover together. */
export const featureHandlers = (core: Core) => Object.assign({}, ...FEATURES.map((f) => f.handlers(core))) as Intersection<ReturnType<(typeof FEATURES)[number]["handlers"]>>;
