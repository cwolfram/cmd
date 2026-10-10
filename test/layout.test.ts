// Where code goes (docs/architecture-review-01/17): counts that only go down, in the
// style of design-css.test.ts. Loose files at the root of the core and the renderer, entries
// in the renderer's components/, source files over LONG lines per package and the lines of the
// core's composition root (core.ts) are counted in layout-debt.json: a new one fails here (put
// the code in its feature's folder, or split the file), and a count that fell fails too, until
// `pnpm layout-debt` writes the lower one, so a move or a split can't quietly grow back.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.join(import.meta.dirname, "..");
const BASELINE = path.join(import.meta.dirname, "layout-debt.json");
const LONG = 600;
const SOURCE = /\.(ts|tsx|mjs|js)$/;
const SKIP = new Set(["node_modules", "test", "build", "dist", "out"]);

/** The files directly in a folder, or its entries of every kind. */
const flat = (dir: string) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).filter((e) => e.isFile() && SOURCE.test(e.name)).map((e) => e.name);
const entries = (dir: string) => fs.readdirSync(path.join(root, dir));

/** Every source file of a package, tests and build output left out. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(rel));
    else if (SOURCE.test(e.name) && !e.name.includes(".gen.")) out.push(rel);
  }
  return out;
}
const lines = (file: string) => fs.readFileSync(path.join(root, file), "utf8").split("\n").length;

const packages = ["packages", "apps", "tools"].flatMap((d) => entries(d).map((p) => `${d}/${p}`)).filter((p) => fs.existsSync(path.join(root, p, "package.json")));

/** What each count is made of, so a failure names the files. */
const now: Record<string, string[]> = {
  "flat files in packages/core/src": flat("packages/core/src"),
  "flat files in apps/desktop/src/renderer/src": flat("apps/desktop/src/renderer/src"),
  "entries in apps/desktop/src/renderer/src/components": entries("apps/desktop/src/renderer/src/components"),
  ...Object.fromEntries(packages.map((p) => [`files over ${LONG} lines in ${p}`, sources(p).filter((f) => lines(f) > LONG)])),
  // The core's composition root (AR1-03-01): what a feature does goes in its folder, not here. One entry per line.
  "lines in packages/core/src/kernel/core.ts": Array.from({ length: lines("packages/core/src/kernel/core.ts") }, (_, i) => `line ${i + 1}`),
};
const counts = Object.fromEntries(Object.entries(now).map(([k, v]) => [k, v.length]));

describe("repo layout", () => {
  it("found the packages", () => {
    expect(packages).toContain("packages/core");
    expect(packages).toContain("apps/desktop");
  });

  if (process.env.UPDATE_LAYOUT_DEBT) {
    it("writes layout-debt.json", () => {
      fs.writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + "\n");
    });
    return;
  }

  const base = JSON.parse(fs.readFileSync(BASELINE, "utf8")) as Record<string, number>;

  it("no count is higher than layout-debt.json allows", () => {
    const over = Object.entries(now)
      .filter(([k, v]) => v.length > (base[k] ?? 0))
      .map(([k, v]) => `${v.length} ${k}, ${base[k] ?? 0} allowed. Put new code in its feature's folder, or split the file:\n    ${v.sort().slice(0, 20).join("\n    ")}${v.length > 20 ? "\n    …" : ""}`);
    expect(over, over.join("\n")).toEqual([]);
  });

  it("layout-debt.json is no higher than the tree (pnpm layout-debt locks in what got better)", () => {
    const under = Object.entries(base)
      .filter(([k, n]) => n > (counts[k] ?? 0))
      .map(([k, n]) => `${k}: went from ${n} to ${counts[k] ?? 0}`);
    expect(under, `Run pnpm layout-debt to lower the baseline:\n${under.join("\n")}`).toEqual([]);
  });
});
