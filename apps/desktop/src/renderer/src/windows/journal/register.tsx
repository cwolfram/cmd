// The Journal widget (renderer half): scoped to this workspace or all of them.

import type { AppWindow } from "@cmd/protocol";
import { JournalView } from "./JournalView.tsx";
import { scopeMenu, scopeOf, scopeLabel } from "../../widgets.ts";
import { registerWindowView } from "../registry.ts";

const journalMenu = (w: AppWindow) => scopeMenu(w.id, scopeOf(w.state.scope));

registerWindowView({
  kind: "journal",
  View: JournalView,
  describe: () => ({ kind: null }),
  titleMenu: (w) => ({ label: scopeLabel(w), entries: journalMenu(w) }),
  menu: journalMenu,
});
