// The UI Workbench's catalog (docs/47), read from the real sources: the kit's components
// with their props as written (union order, defaults, docs), the story files with ids from
// their paths and notes from their comments, and the guesses that let a component render
// without a story. Every story file must import only what exists (a dead import kept
// settings/remote from loading).
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { catalogRoots, extractCatalog, headerOf } from "../src/renderer/src/workbench/catalog/extract.ts";
import type { Catalog, ComponentInfo } from "../src/renderer/src/workbench/catalog/types.ts";
import { argsFor, matrixOf } from "../src/renderer/src/workbench/args.ts";

const repo = path.join(import.meta.dirname, "../../..");
let catalog: Catalog;
const kit = (name: string): ComponentInfo => catalog.components.find((c) => c.id === `ui/${name}`)!;
const prop = (c: string, p: string) => kit(c).props.find((x) => x.name === p);

beforeAll(() => {
  catalog = extractCatalog(catalogRoots(repo));
}, 30_000);

describe("components", () => {
  it("finds the kit's components, not its constants or types", () => {
    expect(catalog.components.filter((c) => c.kit).length).toBeGreaterThan(100);
    const names = catalog.components.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["Button", "Dialog", "ErrorBoundary", "DataGrid"]));
    expect(names).not.toEqual(expect.arrayContaining(["ICON", "MOTION", "ButtonProps"]));
  });

  it("reads a union's values in the order they're written, through aliases", () => {
    expect(prop("Button", "variant")).toMatchObject({ kind: "union", values: ["default", "primary", "danger", "ghost"], default: '"default"' });
    const tone = fs.readFileSync(path.join(repo, "packages/ui/src/status.tsx"), "utf8").match(/export type Tone = ([^;]+);/)![1]!;
    expect(prop("Badge", "tone")!.values).toEqual([...tone.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  });

  it("keeps docs, kinds and requiredness", () => {
    expect(prop("Button", "busy")).toMatchObject({ kind: "boolean", required: false, doc: expect.stringContaining("spinner") });
    expect(prop("Switch", "onChange")).toMatchObject({ kind: "function", required: true });
    expect(prop("Switch", "label")).toMatchObject({ kind: "string", required: true });
    expect(prop("FeatureList", "items")!.kind).toBe("other");
  });

  it("drops DOM props, except children where the component takes them", () => {
    expect(prop("Button", "onMouseEnter")).toBeUndefined();
    expect(prop("Button", "className")).toBeUndefined();
    expect(prop("Button", "children")).toBeDefined();
    expect(prop("TextField", "children")).toBeUndefined();
    expect(prop("TextField", "disabled")).toBeDefined();
  });
});

describe("stories", () => {
  it("finds every story file once, with an id from its path", () => {
    const files = (fs.readdirSync(path.join(repo, "apps/desktop/src/renderer/src"), { recursive: true }) as string[]).filter((f) => f.endsWith(".story.tsx"));
    expect(catalog.stories.filter((s) => !s.file.startsWith("packages/")).length).toBe(files.length);
    const ids = catalog.stories.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("shell/feedback");
    expect(ids).toContain("windows/pdf/pdfview");
  });

  it("reads notes from the comments above exports and the file's header", () => {
    const find = catalog.stories.find((s) => s.id === "components/findbar")!;
    expect(find.doc).toMatch(/^The kit's FindBar/);
    expect(find.variants.find((v) => v.name === "Docked")?.doc).toMatch(/toolbar/);
    // What it renders from the kit, not its own Stage (a local namesake of the kit's).
    expect(find.components[0]).toBe("ui/FindBar");
    expect(find.components).toEqual(expect.arrayContaining(["ui/WindowToolbar", "ui/Window"]));
    expect(find.components).not.toContain("ui/Stage");
    expect(catalog.stories.find((s) => s.id === "shell/feedback")!.components).toContain("shell/Feedback");
  });

  it("imports only files that exist", () => {
    const missing: string[] = [];
    for (const s of catalog.stories) {
      const src = fs.readFileSync(path.join(repo, s.file), "utf8");
      for (const m of src.matchAll(/^import\s+(?:[^"']+\s+from\s+)?["'](\.[^"']+)["']/gm))
        if (!fs.existsSync(path.resolve(path.dirname(path.join(repo, s.file)), m[1]!.replace(/\?.*$/, "")))) missing.push(`${s.file}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
  });

  it("takes a file's header, not a doc comment on its first declaration", () => {
    expect(headerOf("// What this file is,\n// in two lines.\nimport x from 'y';")).toBe("What this file is, in two lines.");
    expect(headerOf("/** The first export's doc. */\nexport const A = 1;")).toBeUndefined();
  });
});

describe("coverage", () => {
  it("every kit component renders from its props, or a story shows it", () => {
    const shown = new Set(catalog.stories.flatMap((s) => s.components));
    const bare = catalog.components.filter((c) => c.kit && !shown.has(c.id) && argsFor(c).missing.length).map((c) => `${c.name} (needs ${argsFor(c).missing.join(", ")})`);
    expect(bare, "Write a story beside it (packages/ui/src/<file>.story.tsx) that renders it").toEqual([]);
  });
});

describe("guessed props", () => {
  it("gives a component what it needs to render", () => {
    expect(argsFor(kit("Button")).args).toMatchObject({ children: "Button" });
    expect(argsFor(kit("Switch")).args).toMatchObject({ checked: false, label: "Switch" });
    const seg = argsFor(kit("Segmented"));
    expect(seg.missing).toEqual([]);
    expect(seg.args.value).toBe((seg.args.options as string[])[0]);
    expect(argsFor(kit("TextField")).args).not.toHaveProperty("children");
  });

  it("names what it can't guess", () => {
    expect(argsFor(kit("DataGrid")).missing).toEqual(expect.arrayContaining(["columns", "rows"]));
    expect(argsFor(kit("DataGrid"), { columns: [], rows: [] }).missing).toEqual([]);
  });

  it("crosses the first two unions and lays out the rest one row each", () => {
    const m = matrixOf(kit("Button"));
    expect([m.cross?.cols.name, m.cross?.rows.name]).toEqual(["variant", "size"]);
    expect(m.rows.map((p) => p.name)).toEqual(expect.arrayContaining(["busy", "pressed", "disabled"]));
    expect(matrixOf(kit("Dialog")).rows.map((p) => p.name)).not.toContain("open");
  });
});
