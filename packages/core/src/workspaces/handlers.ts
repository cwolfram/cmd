// The workspaces' methods (workspace.*, docs/11): open one on a folder, match a path, change,
// close and forget them.

import type { CoreContext } from "../kernel/context.ts";
import { slice } from "../kernel/handlers.ts";

export const workspaceHandlers = (core: CoreContext) =>
  slice({
    "workspace.list": (p) => core.workspaces.list(p.closed),
    "workspace.open": (p) => {
      const r = core.workspaces.open(p.path, p);
      if (p.show) core.broadcast({ type: "workspace.show", workspaceId: r.workspace.id, newWindow: !!p.newWindow });
      return r;
    },
    "workspace.match": (p) => core.workspaces.match(p.path, p.cwd),
    "workspace.update": (p) => {
      const sel = p.view?.["selection.pane"];
      if (typeof sel === "string") core.windowOps.focused(p.id, sel);
      return core.workspaces.update(p.id, p);
    },
    "workspace.close": (p) => (core.windowOps.closeWorkspace(p.id), null),
    "workspace.forget": (p) => (core.workspaces.forget(p.id), null),
  });
