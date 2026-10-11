// The Stats widget (renderer half, docs/49): scoped to this workspace or all of them.

import type { AppWindow } from "@cmd/protocol";
import { StatsView } from "./StatsView.tsx";
import { scopeMenu, scopeOf, scopeLabel } from "../../lib/widgets.ts";
import { registerWindowView } from "../registry.ts";

const statsMenu = (w: AppWindow) => scopeMenu(w.id, scopeOf(w.state.scope));

registerWindowView({
  kind: "stats",
  View: StatsView,
  describe: () => ({ kind: null }),
  titleMenu: (w) => ({ label: scopeLabel(w), entries: statsMenu(w) }),
  menu: statsMenu,
});
