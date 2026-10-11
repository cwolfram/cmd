// Reading a browser window's page (browser.read): the page lives in the app's renderer, in a
// webview the core can't reach, so the core asks the app windows (the browser.request event)
// and the one showing that window answers (browser.reply), through AppAsk (app-ask.ts).
// Used by the Operator's read tool (docs/51); fails plainly when no app window shows the page.

import type { PageRead, PageReadMode, WindowId } from "@cmd/protocol";
import type { CoreContext } from "../kernel/context.ts";
import { appAsk } from "./app-ask.ts";

/** How long the app has to answer: a page that is loading answers once it can. */
const REPLY_MS = 8000;
const MAX_DEFAULT = 24_000;

export function readPage(core: Pick<CoreContext, "broadcast">, id: WindowId, mode: PageReadMode, selector?: string, max = MAX_DEFAULT): Promise<PageRead> {
  if (mode !== "markdown" && !selector?.trim()) return Promise.reject(new Error(`${mode} needs a selector`));
  return appAsk(core).ask<PageRead>(
    (reqId) => ({ type: "browser.request", reqId, id, mode, selector, max: Math.min(Math.max(max, 1000), 100_000) }),
    REPLY_MS,
    "no app window shows this page right now (it may be in another workspace, or still loading): show it and read again",
  );
}
