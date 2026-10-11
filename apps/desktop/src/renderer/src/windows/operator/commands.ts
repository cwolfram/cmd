// The Operator's command (docs/51): Ask Operator… (⌘J) shows the workspace's Operator, docked
// beside the board the first time, and puts the cursor in its prompt.

import { selectPane } from "../../lib/actions.ts";
import { cmd } from "../../lib/bridge.ts";
import { getState } from "../../lib/store.ts";
import { closeSheet } from "../../shell/sheets.ts";
import { boardOf } from "../../shell/board/board.ts";
import { dock } from "../../shell/board/docks.ts";
import { setDocks } from "../../shell/board/view.ts";
import { registerCommands } from "../../shell/commands/registry.ts";

async function ask(): Promise<void> {
  closeSheet();
  const st = getState();
  const w = [...st.windows.values()].find((x) => x.kind === "operator" && x.workspaceId === st.workspaceId);
  if (w) return selectPane(w.id);
  const made = await cmd.call("widget.add", { ref: "type:operator", workspaceId: st.workspaceId });
  // Docked at the right, beside the windows it works on, when that side is free.
  if (!boardOf(getState()).docks.right.id) setDocks((d) => dock(d, made.id, "right"));
  selectPane(made.id);
}

registerCommands({
  "operator.ask": { run: () => void ask() },
});
