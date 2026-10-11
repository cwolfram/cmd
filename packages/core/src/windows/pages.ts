// Reading a browser window's page (browser.read): the page lives in the app's renderer, in a
// webview the core can't reach, so the core asks the app windows (the browser.request event)
// and the one showing that window answers (browser.reply). Like Magic previews' round trip.
// Used by the Operator's read tool (docs/51); fails plainly when no app window shows the page.

import { randomUUID } from "node:crypto";
import type { CoreEvent, PageRead, PageReadMode, WindowId } from "@cmd/protocol";
import type { CoreContext } from "../kernel/context.ts";

/** How long the app has to answer: a page that is loading answers once it can. */
const REPLY_MS = 8000;
const MAX_DEFAULT = 24_000;

export class PageReader {
  #broadcast: (e: CoreEvent) => void;
  #waiting = new Map<string, { resolve: (r: PageRead) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();

  constructor(broadcast: (e: CoreEvent) => void) {
    this.#broadcast = broadcast;
  }

  read(id: WindowId, mode: PageReadMode, selector?: string, max = MAX_DEFAULT): Promise<PageRead> {
    if (mode !== "markdown" && !selector?.trim()) return Promise.reject(new Error(`${mode} needs a selector`));
    const reqId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiting.delete(reqId);
        reject(new Error("no app window shows this page right now (it may be in another workspace, or still loading): show it and read again"));
      }, REPLY_MS);
      this.#waiting.set(reqId, { resolve, reject, timer });
      this.#broadcast({ type: "browser.request", reqId, id, mode, selector, max: Math.min(Math.max(max, 1000), 100_000) });
    });
  }

  /** The first answer wins; a late or second one is dropped. */
  reply(reqId: string, result: PageRead | undefined, error: string | undefined): void {
    const w = this.#waiting.get(reqId);
    if (!w) return;
    this.#waiting.delete(reqId);
    clearTimeout(w.timer);
    if (error || !result) w.reject(new Error(error || "the page didn't answer"));
    else w.resolve(result);
  }
}

const readers = new WeakMap<object, PageReader>();

/** The core's page reader, made on first use. */
export function pagesOf(core: Pick<CoreContext, "broadcast">): PageReader {
  let r = readers.get(core);
  if (!r) readers.set(core, (r = new PageReader((e) => core.broadcast(e))));
  return r;
}
