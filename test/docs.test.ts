// The design docs (docs/NN-*.md) can be cited by number: each number is used once, each doc
// says under its title whether it is research, a proposal, built or superseded, and the index
// in docs/00-overview.md lists every one, so an agent can tell a current design from an old one.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = path.join(import.meta.dirname, "../docs");
const docs = fs.readdirSync(dir).filter((f) => /^\d\d-.+\.md$/.test(f)).sort();
const STATUS = /^\*\*Status:\*\* (research|proposal|partly built|built|reference|superseded by \d\d)\b/m;

describe("design docs", () => {
  it("found them", () => {
    expect(docs.length).toBeGreaterThan(40);
  });

  it("use each number once (the next free one is the highest + 1)", () => {
    const seen = new Map<string, string[]>();
    for (const d of docs) seen.set(d.slice(0, 2), [...(seen.get(d.slice(0, 2)) ?? []), d]);
    expect([...seen.values()].filter((v) => v.length > 1)).toEqual([]);
  });

  it("say what they are: a **Status:** line in the first lines", () => {
    const missing = docs.filter((d) => !STATUS.test(fs.readFileSync(path.join(dir, d), "utf8").split("\n").slice(0, 12).join("\n")));
    expect(missing, "Add **Status:** research | proposal | partly built | built | reference | superseded by NN under the title").toEqual([]);
  });

  it("are all in the index (docs/00-overview.md)", () => {
    const index = fs.readFileSync(path.join(dir, "00-overview.md"), "utf8");
    expect(docs.filter((d) => d !== "00-overview.md" && !index.includes(`](${d})`))).toEqual([]);
  });

  it("name the UI Workbench, not the gallery it replaced (docs/48)", () => {
    // Exact phrases: the Widget Library is "a gallery" too.
    const OLD = /pnpm ui\b|Gallery\.tsx|packages\/ui\/gallery|@cmd\/ui gallery|gallery specimen|the gallery's/i;
    const root = path.join(dir, "..");
    const skills = path.join(root, ".claude/skills");
    const current = docs.filter((d) => /^\*\*Status:\*\* (proposal|partly built|built)\b/m.test(fs.readFileSync(path.join(dir, d), "utf8")) && d !== "48-workbench.md").map((d) => path.join(dir, d));
    const files = [
      ...["CLAUDE.md", "DEVELOPMENT.md", "README.md"].map((f) => path.join(root, f)),
      ...(fs.existsSync(skills) ? fs.readdirSync(skills).map((s) => path.join(skills, s, "SKILL.md")).filter((f) => fs.existsSync(f)) : []),
      ...current,
    ];
    const found = files.flatMap((f) => fs.readFileSync(f, "utf8").split("\n").flatMap((l, i) => (OLD.test(l) ? [`${path.relative(root, f)}:${i + 1}`] : [])));
    expect(found, "The gallery is gone: point to the UI Workbench (pnpm workbench, a story beside the component)").toEqual([]);
  });
});
