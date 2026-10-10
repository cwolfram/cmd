// Resources (renderer half): a list widget of what terminals use, scoped, with Open Task Manager.

import { cmd } from "../../bridge.ts";
import { ResourcesView } from "./ResourcesView.tsx";
import { scopeLabel, scoped } from "../../widgets.ts";
import { registerWindowView } from "../registry.ts";

const resourcesMenu = scoped(() => [{ label: "Open Task Manager", run: () => cmd.openTaskManager() }]);

registerWindowView({
  kind: "resources",
  View: ResourcesView,
  describe: () => ({ kind: null }),
  titleMenu: (w) => ({ label: scopeLabel(w), entries: resourcesMenu(w) }),
  menu: resourcesMenu,
});
