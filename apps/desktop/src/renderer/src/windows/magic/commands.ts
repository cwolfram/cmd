// A Magic widget's commands (Widgets menu): change it, refresh its data, stop a build, take it
// off the board; through the widget's window actions (MagicView).

import { closePane } from "../../lib/actions.ts";
import { isWidget } from "../../lib/model.ts";
import { registerCommands } from "../../shell/commands/registry.ts";

registerCommands({
  "view.magicChange": { when: (c) => !!c.actions?.change, run: (c) => c.actions?.change?.() },
  "view.magicRefresh": { when: (c) => !!c.actions?.refresh, run: (c) => c.actions?.refresh?.() },
  "view.magicStop": { when: (c) => !!c.actions?.stop, run: (c) => c.actions?.stop?.() },
  "widget.remove": { when: (c) => isWidget(c.window), run: (c) => void closePane(c.selected!) },
});
