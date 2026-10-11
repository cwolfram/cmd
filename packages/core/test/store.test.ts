// The core's database (kernel/store.ts) on its own: the copy guard restore relies on,
// the Spaces rename an older file gets once, a window's UI state going with it, and
// transactions that roll back.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { Store } from "../src/kernel/store.ts";
import { rmTemp } from "./tmp.ts";

const dirs: string[] = [];
const tmp = () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmd-store-")));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach(rmTemp));

describe("Store", () => {
  it("says once where a copied file came from (restore resurrects nothing from a copy), then nothing", () => {
    const dir = tmp();
    const a = path.join(dir, "a.sqlite");
    const s = new Store(a);
    expect(s.claim()).toBeNull(); // new
    expect(s.claim()).toBeNull();
    s.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    s.close();
    const b = path.join(dir, "b.sqlite");
    fs.copyFileSync(a, b);
    const copy = new Store(b);
    expect(copy.claim()).toBe(a);
    expect(copy.claim()).toBeNull();
    copy.close();
  });

  it("renames an older file's Spaces to Workspaces, once", () => {
    const file = path.join(tmp(), "old.sqlite");
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE spaces (id TEXT PRIMARY KEY, doc TEXT NOT NULL); CREATE TABLE windows (id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at INTEGER)`);
    old.prepare(`INSERT INTO spaces VALUES ('s1', ?)`).run(JSON.stringify({ id: "s1", name: "Shop", root: "/shop", createdAt: 1, closedAt: null }));
    old.prepare(`INSERT INTO windows VALUES ('w1', ?, 1)`).run(JSON.stringify({ id: "w1", kind: "text", spaceId: "s1" }));
    old.close();
    const s = new Store(file);
    const has = (t: string) => !!s.db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t);
    expect([has("spaces"), has("workspaces")]).toEqual([false, true]);
    expect((s.db.prepare(`SELECT doc FROM windows WHERE id = 'w1'`).get() as { doc: string }).doc).toContain('"workspaceId":"s1"');
    s.close();
  });

  it("forgets a window's UI state by its id, not another's that ends the same", () => {
    const s = new Store(":memory:");
    s.setUiState("scroll.abc", 1);
    s.setUiState("scroll.xabc", 2);
    s.setUiState("scroll.abcd", 3);
    s.deleteUiStateOf("abc");
    expect(s.uiState()).toEqual({ "scroll.xabc": 2, "scroll.abcd": 3 });
    s.close();
  });

  it("rolls a transaction back when it throws", () => {
    const s = new Store(":memory:");
    expect(() =>
      s.transaction(() => {
        s.setUiState("k", 1);
        throw new Error("no");
      }),
    ).toThrow("no");
    expect(s.uiState()).toEqual({});
    s.close();
  });
});
