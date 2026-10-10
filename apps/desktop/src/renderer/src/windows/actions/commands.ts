// Workspace Actions' commands (docs/39): show the widget, run the last action again.

import { closeSheet } from "../../shell/sheets.ts";
import { registerCommands } from "../../shell/commands/registry.ts";
import { rerunLastAction, showActions } from "./workspaceActions.ts";

registerCommands({
  "actions.show": { run: () => (closeSheet(), void showActions()) },
  "actions.rerun": { run: () => void rerunLastAction().then((ran) => void (ran || showActions())) },
});
