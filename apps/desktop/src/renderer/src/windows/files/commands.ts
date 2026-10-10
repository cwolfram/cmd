// A file browser's commands, in the File menu with their shortcuts, which work only while a
// file browser is selected (CommandSpec.scope "window", so text windows and terminals keep
// ⌘D, ⌘⌫, ⌘↑ and ⌘↓). They act on its selected row (FilesView registers them).

import { registerCommands, type Command, type CommandContext } from "../../shell/commands/registry.ts";

const files = (c: CommandContext) => (c.window?.kind === "files" && !c.editing ? c.actions?.files : undefined);
const own = (name: "newFolder" | "duplicate" | "trash" | "up" | "open"): Command => ({ when: (c) => !!files(c), run: (c) => files(c)?.[name]() });

registerCommands({
  "files.newFolder": own("newFolder"),
  "files.duplicate": own("duplicate"),
  "files.trash": own("trash"),
  "files.up": own("up"),
  "files.open": own("open"),
});
