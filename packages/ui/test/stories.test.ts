// Every kit story renders (docs/48): each variant of each src/**/*.story.tsx on the stage
// (test/stage) in Playwright's Chromium, in a dark, a light and a tinted light theme, with no
// page error, no render error and no failed load. A story renders every kit component
// (apps/desktop/test/workbench-catalog.test.ts), so this renders every component as it's
// used. Needs Playwright's Chromium (`pnpm exec playwright install chromium`; CI installs it).

import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { needs } from "../../../test/system.ts";

const here = import.meta.dirname;
const THEMES = ["dark", "light", "solarized-light"];
const noChromium = needs(existsSync(chromium.executablePath()), "Playwright's Chromium (pnpm exec playwright install chromium)");
if (noChromium) it.skip("Playwright's Chromium isn't installed, so the kit's stories aren't rendered", () => {});

describe.skipIf(noChromium)("kit stories (stage, Chromium)", () => {
  let server: ViteDevServer;
  let browser: Browser;
  let page: Page;
  const pageErrors: string[] = [];

  beforeAll(async () => {
    server = await createServer({ configFile: path.join(here, "stage/vite.config.ts"), server: { port: 0 } });
    await server.listen();
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1180, height: 900 } });
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await page.goto(server.resolvedUrls!.local[0]!);
    await page.waitForFunction(() => "stage" in window);
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    await server?.close();
  });

  it("renders every variant in every theme without an error", async () => {
    const list = await page.evaluate(() => (window as unknown as { stage: { list: () => Promise<Record<string, string[]>> } }).stage.list());
    expect(Object.keys(list).length).toBeGreaterThan(10);
    const broken: string[] = [];
    let n = 0;
    for (const theme of THEMES)
      for (const [story, variants] of Object.entries(list))
        for (const variant of variants) {
          const mount = String(++n);
          pageErrors.length = 0;
          await page.evaluate(
            ({ story, variant, theme, mount }) => {
              history.replaceState(null, "", `?${new URLSearchParams({ story, variant, theme, mount })}`);
              dispatchEvent(new Event("stage:url"));
            },
            { story, variant, theme, mount },
          );
          try {
            await page.waitForFunction(({ want, mount }) => document.body.dataset.ready === want && document.body.dataset.mount === mount, { want: `${story}/${variant}`, mount }, { timeout: 10_000 });
          } catch {
            broken.push(`${story}/${variant} (${theme}): didn't render (${(await page.evaluate(() => (window as unknown as { stage: { errors: string[] } }).stage.errors.splice(0))).join("; ").split("\n")[0] || pageErrors[0] || "no error"})`);
            continue;
          }
          // Effects and a frame: what breaks after the first render.
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30))));
          const errors = await page.evaluate(() => (window as unknown as { stage: { errors: string[] } }).stage.errors.splice(0));
          const failed = await page.locator("[data-stage-failed]").count();
          const all = [...errors, ...pageErrors, ...(failed ? ["the story stopped working"] : [])];
          if (all.length) broken.push(`${story}/${variant} (${theme}): ${all[0]!.split("\n")[0]}`);
        }
    expect(broken).toEqual([]);
  }, 300_000);
});
