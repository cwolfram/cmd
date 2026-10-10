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
});
