// @vitest-environment happy-dom
// Acting on a browser window's page (windows/browser/pageActor.ts, for browser.act): a dry run
// finds, describes and outlines the element and tells a password field; then click, fill (as
// frameworks notice: input and change), select by value or text, and the errors the model acts on.
import { beforeEach, describe, expect, it } from "vitest";
import { actScript, type PageActQuery } from "../src/renderer/src/windows/browser/pageActor.ts";

const act = (q: PageActQuery) => (0, eval)(actScript(q)) as ReturnType<typeof JSON.parse>;

beforeEach(() => {
  document.body.innerHTML = `
    <form id="f"><label for="q">Search</label><input id="q" name="q"><input id="pw" type="password" name="password">
    <select id="s"><option value="de">Germany</option><option value="fr">France</option></select>
    <button id="go">Go</button><button>Other</button></form>`;
});

describe("acting on a page", () => {
  it("a dry run describes and outlines the element, and tells a password field", () => {
    const r = act({ action: "fill", selector: "#q", value: "cats", dry: true });
    expect(r).toMatchObject({ element: "<input type=text> Search" });
    expect(r.sensitive).toBeUndefined();
    expect((document.querySelector("#q") as HTMLElement).style.outline).toContain("solid");
    expect(act({ action: "fill", selector: "#pw", value: "x", dry: true })).toMatchObject({ sensitive: true });
    expect(() => act({ action: "fill", selector: "#pw", value: "x" })).toThrow("password, card or code");
  });

  it("fills a field so frameworks notice, picks an option by its text, clicks", () => {
    const seen: string[] = [];
    const q = document.querySelector("#q") as HTMLInputElement;
    q.addEventListener("input", () => seen.push("input"));
    q.addEventListener("change", () => seen.push("change"));
    act({ action: "fill", selector: "#q", value: "cats" });
    expect(q.value).toBe("cats");
    expect(seen).toEqual(["input", "change"]);
    act({ action: "select", selector: "#s", value: "France" });
    expect((document.querySelector("#s") as HTMLSelectElement).value).toBe("fr");
    let clicked = 0;
    document.querySelector("#go")!.addEventListener("click", (e) => (e.preventDefault(), clicked++));
    act({ action: "click", selector: "#go" });
    expect(clicked).toBe(1);
  });

  it("says what to do when the selector is wrong, matches nothing, or matches several", () => {
    expect(() => act({ action: "click", selector: "button[" })).toThrow(`"button[" isn't a CSS selector`);
    expect(() => act({ action: "click", selector: "#nope" })).toThrow(`nothing matches "#nope"`);
    expect(() => act({ action: "click", selector: "button" })).toThrow("matches 2 elements: give index (1 to 2)");
    expect(act({ action: "click", selector: "button", index: 2, dry: true })).toMatchObject({ element: "<button> Other" });
  });
});
