// The menu bar's template, from the shared command list: each menu is a list of groups, a
// group is its commands (by their `menu` slot, in the list's order) or one of macOS's roles.
// Pure (Electron's types only), so a test can check every command is placed exactly once.

import type { MenuItemConstructorOptions } from "electron";
import { COMMANDS, type CommandSpec, type Keybindings } from "../shared/commands.ts";

type Send = (id: string) => void;
type Role = NonNullable<MenuItemConstructorOptions["role"]>;
/** A group of a menu: a command slot ("File/new"), or roles and slots in one run. */
type Part = string | { role: Role };
type Menu = { label?: string; role?: Role; groups: Part[][] };

const r = (role: Role) => ({ role });

/** The menu bar; `mac`: the app-name menu exists, else its items go to File and Help. */
function layout(mac: boolean, appName: string): Menu[] {
  return [
    ...(mac ? [{ label: appName, groups: [[r("about"), "App/updates"], ["App/settings"], [r("services")], [r("hide"), r("hideOthers"), r("unhide")], [r("quit")]] }] : []),
    {
      label: "File",
      groups: [["File/new"], ["File/agents"], ["File/windows"], ["File/workspace"], ["File/save"], ["File/files"], ["File/close"], ["File/settings"], ...(mac ? [] : [["App/settings"], [r("quit")]])],
    },
    { label: "Edit", groups: [[r("undo"), r("redo")], [r("cut"), "Edit/copy", r("paste"), "Edit/select"], ["Edit/find"], ["Edit/terminal"]] },
    { label: "View", groups: [["View/layout"], ["View/sidebars"], ["View/palette"], ["View/zoom"], [r("togglefullscreen")], ["@developer"]] },
    { label: "Session", groups: [["Session/move"], ["Session/select", "Session/agent"]] },
    { label: "Workspace", groups: [["Workspace/move", "Workspace/select"], ["Workspace/edit"], ["Workspace/actions"], ["Workspace/close"]] },
    { label: "Widgets", groups: [["Widgets/library"], ["Widgets/widget"], ["Widgets/remove"]] },
    { role: "windowMenu", groups: [[r("minimize"), r("zoom")], ["Window/dock"], ["Window/size"], ["Window/app"], ...(mac ? [[r("front")]] : [])] },
    { role: "help", groups: [["Help/help"], ...(mac ? [] : [["App/updates"]])] },
  ];
}

/** A command's menu items: the item, and hidden ones for its other shortcuts. */
function items(c: CommandSpec, send: Send, bindings: Keybindings): MenuItemConstructorOptions[] {
  const [first, ...rest] = bindings[c.id] ?? [];
  // A window's own shortcut shows in the menu but is the renderer's to run (CommandSpec.scope).
  const own = c.scope === "window" ? { registerAccelerator: false } : {};
  const main: MenuItemConstructorOptions = { id: c.id, label: c.label, accelerator: first, type: c.checkable, click: () => send(c.id), ...own, ...(c.hidden ? { visible: false, acceleratorWorksWhenHidden: true } : {}) };
  // Extra shortcuts are hidden items that still respond to their key.
  const aliases = rest.map((acc): MenuItemConstructorOptions => ({ label: c.label, accelerator: acc, visible: false, acceleratorWorksWhenHidden: true, click: () => send(c.id), ...own }));
  return [main, ...aliases];
}

export function menuTemplate(send: Send, bindings: Keybindings, o: { mac: boolean; appName: string }): MenuItemConstructorOptions[] {
  const bySlot = new Map<string, CommandSpec[]>();
  for (const c of COMMANDS as readonly CommandSpec[]) bySlot.set(c.menu, [...(bySlot.get(c.menu) ?? []), c]);
  const part = (p: Part): MenuItemConstructorOptions[] => {
    if (typeof p !== "string") return [p];
    if (p === "@developer") return [{ label: "Developer", submenu: [{ role: "reload" }, { role: "toggleDevTools" }] }];
    return (bySlot.get(p) ?? []).flatMap((c) => items(c, send, bindings));
  };
  return layout(o.mac, o.appName).map((m) => {
    const groups = m.groups.map((g) => g.flatMap(part)).filter((g) => g.length);
    const submenu = groups.flatMap((g, i) => (i ? [{ type: "separator" as const }, ...g] : g));
    return { ...(m.label ? { label: m.label } : {}), ...(m.role ? { role: m.role } : {}), submenu };
  });
}

/** Every slot the layout places (for the test: a command in another slot isn't in the menu). */
export function menuSlots(mac: boolean): string[] {
  return layout(mac, "cmd").flatMap((m) => m.groups.flat().filter((p): p is string => typeof p === "string"));
}
