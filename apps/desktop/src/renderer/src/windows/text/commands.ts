// A text window's commands: Go to Line (the palette's ":" mode), comments, line moves and
// folding in the Edit menu, Word Wrap in View. Their keys work only while a text window is
// selected (CommandSpec.scope "window"), and the edits only while its editor has focus, so a
// find field or a terminal keeps ⌥↑ and ⌘[. TextView registers what they run on.

import { cmd } from "../../lib/bridge.ts";
import type { TextEdit } from "../../lib/windowActions.ts";
import { toggleSheet } from "../../shell/sheets.ts";
import { LINE_PREFIX } from "../../shell/Palette.tsx";
import { registerCommands, type Command, type CommandContext } from "../../shell/commands/registry.ts";

const text = (c: CommandContext) => (c.window?.kind === "text" ? c.actions?.text : undefined);
const edit = (name: TextEdit): Command => ({ when: (c) => !!text(c)?.focused(), run: (c) => text(c)?.run(name) });
const wrapped = (c: CommandContext) => c.state.settings.settings["editor.wordWrap"] !== false;

registerCommands({
  "text.goToLine": { when: (c) => !!text(c), run: () => toggleSheet({ kind: "palette", query: LINE_PREFIX }, (s) => s.kind === "palette" && s.query === LINE_PREFIX) },
  "text.toggleComment": edit("toggleComment"),
  "text.moveLineUp": edit("moveLineUp"),
  "text.moveLineDown": edit("moveLineDown"),
  "text.duplicateLine": edit("duplicateLine"),
  "text.deleteLine": edit("deleteLine"),
  "text.indent": edit("indent"),
  "text.outdent": edit("outdent"),
  "text.fold": edit("fold"),
  "text.unfold": edit("unfold"),
  "text.foldAll": edit("foldAll"),
  "text.unfoldAll": edit("unfoldAll"),
  // A setting, not the window's: the choice is remembered for every text window.
  "text.wordWrap": {
    when: (c) => !!text(c),
    checked: wrapped,
    run: (c) => void cmd.call("settings.set", { key: "editor.wordWrap", value: !wrapped(c) }).catch(() => {}),
  },
});
