// Settings keys once shipped stay readable: every key in settings-keys.lock is
// in the schema or has a migration, every schema key is locked, and migrations
// carry old names and values over (AR1-15-04).

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REMOVED_SETTINGS, RENAMED_SETTINGS, resolveSettings, SETTINGS_MIGRATIONS, SETTINGS_SCHEMA, type SettingsMigration } from "../src/index.ts";

const LOCK = path.join(import.meta.dirname, "../settings-keys.lock");
const locked = fs
  .readFileSync(LOCK, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

describe("settings-keys.lock", () => {
  it("has every schema key (append new ones)", () => {
    const missing = Object.keys(SETTINGS_SCHEMA).filter((k) => !locked.includes(k));
    expect(missing, "add these keys to packages/protocol/settings-keys.lock").toEqual([]);
  });

  it("has a home for every key ever shipped: the schema or a migration", () => {
    const moved = new Set(SETTINGS_MIGRATIONS.map((m) => m.from));
    const lost = locked.filter((k) => !Object.hasOwn(SETTINGS_SCHEMA, k) && !moved.has(k));
    expect(lost, "these keys left the schema: add each to SETTINGS_MIGRATIONS (renamed, or removed with to: null)").toEqual([]);
  });

  it("is sorted and has no duplicates", () => {
    expect(locked).toEqual([...new Set(locked)].sort());
  });

  it("migrates only to keys that exist", () => {
    for (const m of SETTINGS_MIGRATIONS) if (m.to) expect(Object.hasOwn(SETTINGS_SCHEMA, m.to), `${m.from} → ${m.to}`).toBe(true);
  });
});

describe("migrations", () => {
  it("ignores removed keys without an error", () => {
    expect(REMOVED_SETTINGS.has("canvas.cardZoom")).toBe(true);
    expect(resolveSettings({ "canvas.cardZoom": 0.5 })).toMatchObject({ errors: [], unknown: [] });
  });

  it("reads a renamed key under its new name, unless the new one is set too", () => {
    expect(RENAMED_SETTINGS["terminal.fontSize"]).toBe("font.codeSize");
    expect(resolveSettings({ "terminal.fontSize": 15 }).settings["font.codeSize"]).toBe(15);
    expect(resolveSettings({ "terminal.fontSize": 15, "font.codeSize": 12 }).settings["font.codeSize"]).toBe(12);
  });

  it("carries a value over to the new key's type, through a chain of renames", () => {
    // A comma list that became a number of entries, renamed twice on the way.
    const migrations: SettingsMigration[] = [
      { from: "old.fonts", to: "mid.fonts" as never, value: (v) => (typeof v === "string" ? v.split(",").length + 10 : v) },
      { from: "mid.fonts", to: "font.codeSize" },
    ];
    expect(resolveSettings({ "old.fonts": "a,b,c" }, migrations)).toMatchObject({ settings: { "font.codeSize": 13 }, errors: [] });
    // Idempotent: a value already in the new form passes.
    expect(resolveSettings({ "old.fonts": 14 }, migrations).settings["font.codeSize"]).toBe(14);
  });

  it("changes a kept key's value in place", () => {
    const migrations: SettingsMigration[] = [{ from: "font.codeSize", to: "font.codeSize", value: (v) => (v === "big" ? 18 : v) }];
    expect(resolveSettings({ "font.codeSize": "big" }, migrations).settings["font.codeSize"]).toBe(18);
  });

  it("reports keys it doesn't know apart from invalid values", () => {
    expect(resolveSettings({ "canvas.zoomz": 1, "font.codeSize": "x" })).toMatchObject({ unknown: ["canvas.zoomz"], errors: ["font.codeSize: expected a number"] });
  });
});
