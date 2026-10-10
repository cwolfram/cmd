// Features that declare themselves in their own folder (docs/architecture-review-01/17,
// AR1-17-05; AR1-16-08): each contributes its slice of the RPC handlers, a startup job and its
// teardown. Its service is a typed field of Core (core.journal), created there from the
// feature's own function; everything else comes from this list.

import type { AppWindow, CoreEvent, Placement, Workspace, AgentId } from "@cmd/protocol";
import type { Core } from "./core.ts";
import type { Handlers } from "./handlers.ts";
import { journalFeature } from "../journal/feature.ts";
import { actionsFeature } from "../actions/feature.ts";
import { timersFeature } from "../windows/timers.ts";

/** What a feature gets: the core's services, and the few things only Core can do. */
export interface FeatureContext {
  core: Core;
  /** An event to every subscribed client. */
  broadcast(event: CoreEvent): void;
  /** The workspace a call is about: the one asked for, the caller's, a parent agent's, else by path. */
  place(p: Placement, o?: { parentId?: AgentId | null; path?: string }): Workspace;
  /** A window just opened: counted, and the Widget Library told. */
  opened<W extends AppWindow | null>(w: W): W;
}

export interface Feature {
  id: string;
  /** Its methods. They are merged into Core.handlers, where a method left out fails tsc. */
  handlers?(ctx: FeatureContext): Partial<Handlers>;
  /** Run once the core answers (docs/34): label is what the footer shows while it runs. */
  startup?: { label: string; run(ctx: FeatureContext): void | Promise<void> };
  dispose?(ctx: FeatureContext): void;
}

export const FEATURES = [journalFeature, actionsFeature, timersFeature] as const satisfies readonly Feature[];
/** The same list, as plain Features (what loops over it need). */
export const ALL: readonly Feature[] = FEATURES;

type Intersection<T> = (T extends unknown ? (x: T) => void : never) extends (x: infer I) => void ? I : never;
type Slices = ReturnType<Extract<(typeof FEATURES)[number], { handlers: unknown }>["handlers"]>;
/** Every feature's handlers, typed as the methods they cover together. */
export const featureHandlers = (ctx: FeatureContext) => Object.assign({}, ...ALL.map((f) => f.handlers?.(ctx) ?? {})) as Intersection<Slices>;
