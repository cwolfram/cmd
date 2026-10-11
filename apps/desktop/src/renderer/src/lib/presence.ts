// Whether this app window has the person's focus, told to the core with the workspace it
// shows (workspace.update present), so focus time (user.focus, docs/49) ends when cmd goes to
// the background or another app window takes focus, and starts again when it's back.

import { cmd } from "./bridge.ts";
import { getState } from "./store.ts";

let told: { id: string; present: boolean } | null = null;

function tell(): void {
  const id = getState().workspaceId;
  const present = document.hasFocus() && document.visibilityState === "visible";
  if (!id || (told?.id === id && told.present === present)) return;
  told = { id, present };
  void cmd.call("workspace.update", { id, present }).catch(() => {});
}

window.addEventListener("focus", tell);
window.addEventListener("blur", tell);
document.addEventListener("visibilitychange", tell);
// A workspace switch in this window: the new one is where focus is now.
setInterval(() => told && told.id !== getState().workspaceId && tell(), 2000);
