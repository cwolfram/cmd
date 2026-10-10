// Workspace Actions (renderer half): the title bar names the folder or worktree they're for, its menu picks which.

import { ACTIONS_TITLE, type AppWindow } from "@cmd/protocol";
import { cmd } from "../../bridge.ts";
import type { MenuEntry } from "../../context.ts";
import { shortPath } from "../../model.ts";
import { ActionsView } from "./ActionsView.tsx";
import { actionsRootOf, lastLists } from "./workspaceActions.ts";
import { getState } from "../../store.ts";
import { setWidgetState } from "../../widgets.ts";
import { registerWindowView } from "../registry.ts";

// Workspace Actions: the title bar names the folder (or worktree) they're for; its
// menu follows the selected terminal's checkout or picks one of the repository's.
const actionsMenu = (w: AppWindow): MenuEntry[] => {
  const settings = getState().settings.settings;
  const set = (key: "actions.describe" | "actions.openBrowser", value: boolean) => void cmd.call("settings.set", { key, value }).catch(() => {});
  const root = actionsRootOf(w);
  const pinned = typeof w.state.path === "string";
  const follow = !pinned && w.state.follow !== false;
  const trees = lastLists.get(w.id)?.worktrees ?? [];
  return [
    { label: "Follow Selected Terminal", checked: follow, run: () => setWidgetState(w.id, { path: null, follow: true }) },
    ...(trees.length > 1
      ? [
          "-" as const,
          ...trees.map((t) => ({
            label: `${t.branch ?? shortPath(t.top)}${t.running ? ` · ${t.running} running` : ""}${t.agents ? ` · ${t.agents} ${t.agents === 1 ? "agent" : "agents"}` : ""}`,
            checked: !follow && t.top === root,
            run: () => setWidgetState(w.id, { path: t.top }),
          })),
        ]
      : []),
    { label: "Use the workspace's Folder", checked: !pinned && !follow, run: () => setWidgetState(w.id, { path: null, follow: false }) },
    "-",
    { label: "Describe with AI", checked: settings["actions.describe"], run: () => set("actions.describe", !settings["actions.describe"]) },
    { label: "Open Dev Servers in a Browser", checked: settings["actions.openBrowser"], run: () => set("actions.openBrowser", !settings["actions.openBrowser"]) },
  ];
};

registerWindowView({
  kind: "actions",
  View: ActionsView,
  describe: () => ({ kind: null }),
  titleMenu: (w) => {
    const root = actionsRootOf(w);
    const branch = lastLists.get(w.id)?.checkout;
    const name = root ? root.replace(/\/+$/, "").split("/").pop() || root : ACTIONS_TITLE;
    // A worktree's branch, unless its folder already says it (cmd-workspace-actions on workspace-actions).
    const showBranch = branch?.linked && branch.branch && !name.endsWith(branch.branch);
    return { label: showBranch ? `${name} · ${branch!.branch}` : name, entries: actionsMenu(w) };
  },
  menu: actionsMenu,
});
