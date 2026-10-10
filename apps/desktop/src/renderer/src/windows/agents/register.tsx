// Agent Activity (renderer half): a list widget scoped to this workspace or all of them.

import { AgentActivity } from "./AgentActivity.tsx";
import { scopeMenu, scopeOf, scopeLabel } from "../../lib/widgets.ts";
import { registerWindowView } from "../registry.ts";

registerWindowView({
  kind: "agents",
  View: AgentActivity,
  describe: () => ({ kind: null }),
  titleMenu: (w) => ({ label: scopeLabel(w), entries: scopeMenu(w.id, scopeOf(w.state.scope)) }),
  menu: (w) => scopeMenu(w.id, scopeOf(w.state.scope)),
});
