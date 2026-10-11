// @vitest-environment happy-dom
// Reading a browser window's page (windows/browser/pageReader.ts, for browser.read): the main
// content as Markdown with links made absolute and tables kept, one element's Markdown, and
// what a CSS selector matches, listed.
import { describe, expect, it } from "vitest";
import { readPage, toMarkdown } from "../src/renderer/src/windows/browser/pageReader.ts";

const PAGE = `<html><head><title>Docs</title></head><body>
  <nav><a href="/">Home</a> <a href="/pricing">Pricing</a></nav>
  <main><article>
    <h1>Install</h1>
    <p>Get it with <code>pnpm add thing</code>, then read <a href="/guide">the guide</a>. ${"It is quick and well documented. ".repeat(20)}</p>
    <h2>Options</h2>
    <table><tr><th>Name</th><th>Default</th></tr><tr><td>port</td><td>3000</td></tr></table>
    <pre><code>thing --port 4000</code></pre>
    <script>alert(1)</script>
  </article></main>
  <footer>© Thing Inc.</footer>
</body></html>`;

describe("the page as Markdown", () => {
  it("keeps the main content: headings, code, absolute links, tables; drops scripts", () => {
    const md = toMarkdown(PAGE, "https://thing.dev/docs", true);
    expect(md).toContain("Install");
    expect(md).toContain("`pnpm add thing`");
    expect(md).toContain("[the guide](https://thing.dev/guide)");
    expect(md).toContain("| Name | Default |");
    expect(md).toContain("```\nthing --port 4000\n```");
    expect(md).not.toContain("alert(1)");
  });

  it("one element, as it is", () => {
    expect(toMarkdown(`<section id="x"><h2>Options</h2><ul><li>port</li><li>host</li></ul></section>`, "https://thing.dev/", false)).toBe("## Options\n\n-   port\n-   host");
  });
});

describe("exploring the page", () => {
  it("lists what a CSS selector matches, with text and absolute links, and says how many", async () => {
    document.documentElement.innerHTML = PAGE.replace(/^<html>|<\/html>$/g, "");
    const run = async (script: string) => (0, eval)(script) as unknown;
    const r = await readPage(run, { mode: "css", selector: "a", max: 10_000 });
    expect(r.matches).toBe(3);
    expect(r.text).toMatch(/^\[1\] <a href="[^"]*\/"> Home\n\[2\] <a href="[^"]*\/pricing"> Pricing\n\[3\] <a href="[^"]*\/guide"> the guide$/);
    await expect(readPage(run, { mode: "css", selector: "a[", max: 10_000 })).rejects.toThrow(`"a[" isn't a CSS selector`);
  });
});
