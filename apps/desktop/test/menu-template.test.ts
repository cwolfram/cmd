// The menu bar comes from the command list (main/menu-template.ts): every command is in it
// exactly once, shown or hidden, on macOS and elsewhere, and a window's own shortcut doesn't
// register with the menu (the window runs it).
import { describe, expect, it } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import { menuSlots, menuTemplate } from "../src/main/menu-template.ts";
import { COMMANDS, DEFAULT_KEYBINDINGS, type CommandSpec } from "../src/shared/commands.ts";

const flat = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] => items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flat(i.submenu) : [])]);

describe("the menu bar", () => {
  for (const mac of [true, false]) {
    it(`places every command exactly once (${mac ? "macOS" : "Windows/Linux"})`, () => {
      const items = flat(menuTemplate(() => {}, DEFAULT_KEYBINDINGS, { mac, appName: "cmd" }));
      const ids = items.flatMap((i) => (i.id ? [i.id] : []));
      for (const c of COMMANDS) expect(ids.filter((id) => id === c.id), c.id).toHaveLength(1);
      expect(ids.length).toBe(COMMANDS.length);
    });
  }

  it("has a group for every command's slot", () => {
    const slots = new Set(menuSlots(true));
    expect((COMMANDS as readonly CommandSpec[]).filter((c) => !slots.has(c.menu)).map((c) => c.id)).toEqual([]);
  });

  it("leaves a window's own shortcuts to the window", () => {
    const items = flat(menuTemplate(() => {}, DEFAULT_KEYBINDINGS, { mac: true, appName: "cmd" }));
    for (const c of (COMMANDS as readonly CommandSpec[]).filter((c) => c.scope === "window")) {
      expect(items.find((i) => i.id === c.id)?.registerAccelerator, c.id).toBe(false);
    }
  });
});
