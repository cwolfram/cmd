// Edit: copy and select in a terminal's buffer, or natively anywhere else (fields, text and
// files windows, browser pages, widgets); find in the selected window; a terminal's prompts
// and last output.

import type { WebviewTag } from "electron";
import { cmd } from "../../lib/bridge.ts";
import type { FindRequest } from "../../lib/find.tsx";
import { terminals } from "../../windows/terminal/terminals.ts";
import { registerCommands, type CommandContext } from "./registry.ts";

/** Copy / Select All in the focused browser page (its own WebContents), input, text window or Magic widget. */
const editNative = (op: "copy" | "selectAll") => {
  const el = document.activeElement;
  cmd.editNative(op, el?.tagName === "WEBVIEW" ? (el as WebviewTag).getWebContentsId() : undefined);
};

/** In a field of the window's own (its find bar, a text window's editor) the window finds; in a sheet or the palette nothing does. */
const findIn = (c: CommandContext, r: FindRequest) => {
  if (!c.selected || (c.editing && document.activeElement?.closest("[role=dialog], .palette-backdrop"))) return;
  if (c.pane) terminals.requestFind(c.selected, r);
  else c.actions?.find?.(r);
};
const canFind = (c: CommandContext) => !!c.pane || !!c.actions?.find;

registerCommands({
  // Terminals copy and select their own buffer; everything else gets the native command.
  // In a terminal only with text selected (it reports when that flips); elsewhere the field or page decides.
  "edit.copy": { when: (c) => c.editing || !c.pane || terminals.hasSelection(c.pane.id), run: (c) => (c.editing || !c.pane || !terminals.copy(c.pane.id)) && editNative("copy") },
  "edit.selectAll": { run: (c) => (c.editing || !c.pane ? editNative("selectAll") : terminals.selectAll(c.pane.id)) },
  "edit.clear": { when: (c) => !!c.pane, run: (c) => terminals.clear(c.pane!.id) },
  // Find in the terminal's scrollback, or in a text window (CodeMirror's panel).
  "edit.find": { when: canFind, run: (c) => findIn(c, "open") },
  "edit.findNext": { when: canFind, run: (c) => findIn(c, "next") },
  "edit.findPrev": { when: canFind, run: (c) => findIn(c, "prev") },
  "edit.findReplace": { when: (c) => canFind(c) && !c.pane, run: (c) => findIn(c, "replace") },
  "edit.findSelection": { when: canFind, run: (c) => findIn(c, "selection") },
  "edit.copyLastOutput": { when: (c) => !!c.pane, run: (c) => terminals.copyLastOutput(c.pane!.id) },
  "terminal.prevPrompt": { when: (c) => !!c.pane, run: (c) => terminals.jumpToPrompt(c.pane!.id, -1) },
  "terminal.nextPrompt": { when: (c) => !!c.pane, run: (c) => terminals.jumpToPrompt(c.pane!.id, 1) },
});
