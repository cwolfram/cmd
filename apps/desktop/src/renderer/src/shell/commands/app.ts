// The app's own commands: Settings and setup, updates, remote access, the core, Help, and the
// sheets over the board (palette, What's New, Feedback, Task Manager).

import { compareVersions } from "../../../../shared/changelog.ts";
import { cmd } from "../../lib/bridge.ts";
import { getState } from "../../lib/store.ts";
import { showSetup } from "../../onboarding/Onboarding.tsx";
import { restartCore } from "../coreHealth.ts";
import { SEARCH_PREFIX } from "../Palette.tsx";
import { closeSheet, openSheet, toggleSheet } from "../sheets.ts";
import { APP_VERSION, RELEASES } from "../WhatsNew.tsx";
import { registerCommands } from "./registry.ts";

registerCommands({
  "app.settings": { run: () => cmd.openSettings() },
  "app.setup": { run: () => (closeSheet(), showSetup()) },
  "app.checkUpdates": { run: () => cmd.checkForUpdates() },
  "app.restartCore": { run: () => void restartCore() },
  "app.remoteAccess": { run: () => cmd.openSettings("remote") },
  "app.pairDevice": { run: () => cmd.openSettings("remote/pair") },
  "app.disconnectRemote": { run: () => void cmd.call("remote.disconnect", {}).catch(() => {}) },
  "app.taskManager": { run: () => openSheet({ kind: "taskManager" }) },
  "file.openSettingsFile": { run: () => cmd.openSettingsFile(getState().settings.path) },
  "file.closeWindow": { run: () => cmd.closeWindow() },
  "view.palette": { run: () => toggleSheet({ kind: "palette", query: "" }) },
  // The palette in search mode (docs/33): `?` typed for you; backspace it for commands.
  "view.search": { run: () => toggleSheet({ kind: "palette", query: SEARCH_PREFIX }, (s) => s.kind === "palette" && s.query === SEARCH_PREFIX) },
  "help.docs": { run: () => cmd.openDocs() },
  "help.feedback": { run: () => openSheet({ kind: "feedback" }) },
  "help.whatsNew": { run: () => openSheet({ kind: "whatsNew", releases: RELEASES.filter((r) => compareVersions(r.version, APP_VERSION) <= 0) }) },
});
