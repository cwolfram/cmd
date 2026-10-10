// Commands (renderer half): a list widget of the commands terminals ran, scoped, with Failed Only.

import { CommandsView } from "./CommandsView.tsx";
import { setWidgetState, scopeLabel, scoped } from "../../lib/widgets.ts";
import { registerWindowView } from "../registry.ts";

const commandsMenu = scoped((w) => [{ label: "Failed Only", checked: w.state.failedOnly === true, run: () => setWidgetState(w.id, { failedOnly: w.state.failedOnly !== true }) }]);

registerWindowView({
  kind: "commands",
  View: CommandsView,
  describe: () => ({ kind: null }),
  titleMenu: (w) => ({ label: scopeLabel(w), entries: commandsMenu(w) }),
  menu: commandsMenu,
});
