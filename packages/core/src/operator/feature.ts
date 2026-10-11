// The Operator as one feature (docs/51-operator.md; kernel/features.ts): its widget type, its
// methods (OperatorMethods, protocol operator.ts) and its teardown. The service acts through
// the core's own methods (CoreContext.call), gated by OPERATOR_ACCESS, and asks the AI
// service for each turn; it is made with the first call, one per core.

import { OPERATOR_TITLE, type OperatorMethods } from "@cmd/protocol";
import type { CoreContext } from "../kernel/context.ts";
import type { Feature } from "../kernel/features.ts";
import type { HandlerSlice } from "../kernel/handlers.ts";
import type { WindowType } from "../windows/types.ts";
import { OperatorService } from "./service.ts";

/** The Operator widget: one per workspace is enough, the conversation is the workspace's. */
export const operatorType: WindowType = {
  kind: "operator",
  title: OPERATOR_TITLE,
  icon: "brain",
  role: "widget",
  description: "Ask it to run your workspace: run the tests, start agents on what fails, wait for them and tell you. You watch every step and say yes before it types anything.",
  create: () => ({ state: {}, title: OPERATOR_TITLE }),
  update: (state) => ({ state }),
};

const services = new WeakMap<CoreContext, OperatorService>();

/** The core's Operator, made on first use. */
export function operatorOf(core: CoreContext): OperatorService {
  let s = services.get(core);
  if (!s) {
    s = new OperatorService({
      workspace: (id) => core.workspaces.get(id) ?? null,
      call: (m, p) => core.call(m, p as never),
      agent: (r) => core.ai.agent({ ...r, tier: "smart", purpose: "operator" }),
      selfIn: (id) => core.windows.others().find((w) => w.kind === "operator" && w.workspaceId === id)?.id ?? null,
      broadcast: (e) => core.broadcast(e),
      onAgent: (fn) => void core.agents.on("updated", fn),
      onCommandEnd: (fn) => void core.panes.on("osc", (id, ev) => ev.type === "prompt" && ev.mark === "D" && fn(id, ev.exitCode ?? null)),
      onServing: (fn) => void core.actions.on("url", fn),
      notify: (_id, title, body) => core.notifications.info(title, body),
      // A terminal's window is its pane: its tool calls are found with the terminal's other events too.
      record: (e) => core.data.record(e.windowId && core.panes.get(e.windowId) ? { ...e, paneId: e.windowId } : e),
      db: core.store.db,
    });
    services.set(core, s);
  }
  return s;
}

export const operatorFeature = {
  id: "operator",
  handlers: (core: CoreContext): HandlerSlice<keyof OperatorMethods> => ({
    "operator.get": (p) => operatorOf(core).get(p.workspaceId),
    "operator.send": (p) => (operatorOf(core).send(p.workspaceId, p.text, p.selected ?? null), null),
    "operator.stop": (p) => (operatorOf(core).stop(p.workspaceId), null),
    "operator.answer": (p) => (operatorOf(core).answer(p.workspaceId, p.itemId, p.allow, p.reason), null),
    "operator.reset": (p) => (operatorOf(core).reset(p.workspaceId), null),
  }),
  dispose: (core: CoreContext) => services.get(core)?.dispose(),
} satisfies Feature;
