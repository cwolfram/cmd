// File: new windows and agents, opening workspaces, saving, closing (⌘W closes the frontmost
// thing: a sheet, onboarding, the selected window, then the app window) and reopening.

import { closePane, newAgent, newBrowser, newFiles, newMagic, newTerminal, newText } from "../../lib/actions.ts";
import { cmd } from "../../lib/bridge.ts";
import { setupOpen } from "../../onboarding/Onboarding.tsx";
import { reopenClosed } from "../closed.ts";
import { closeSheet, currentSheet, endSetup, openSheet, toggleSheet } from "../sheets.ts";
import { registerCommands } from "./registry.ts";

registerCommands({
  // ⌘N: one picker for every new window and widget (shell/newItems.ts).
  "file.new": { run: () => toggleSheet({ kind: "picker", picker: { kind: "new" } }, (s) => s.kind === "picker" && s.picker.kind === "new") },
  "file.newTerminal": { run: () => void newTerminal() },
  "file.newClaude": { run: () => void newAgent("claude") },
  "file.newCodex": { run: () => void newAgent("codex") },
  "file.newBrowser": { run: () => void newBrowser() },
  "file.newFiles": { run: () => void newFiles() },
  "file.newText": { run: () => void newText() },
  // Widgets (docs/16-widgets.md): the Widget Library, and making one with Magic.
  "widget.library": { run: () => toggleSheet({ kind: "library" }) },
  "file.newMagic": { run: () => (currentSheet()?.kind === "library" && closeSheet(), void newMagic()) },
  "file.openWorkspace": { run: () => openSheet({ kind: "picker", picker: { kind: "workspace" } }) },
  "file.newWindow": { run: () => openSheet({ kind: "picker", picker: { kind: "workspace", newWindow: true } }) },
  "file.save": { when: (c) => !!c.actions?.save, run: (c) => void c.actions?.save?.() },
  "file.close": {
    run: (c) => {
      if (currentSheet() && !c.forTarget) closeSheet();
      else if (setupOpen() && !c.forTarget) endSetup();
      else if (c.selected) void closePane(c.selected);
      else cmd.closeWindow();
    },
  },
  "file.reopenClosed": { when: (c) => c.canReopen, run: () => reopenClosed() },
});
