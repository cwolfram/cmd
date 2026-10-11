// Reading a browser window's page (core windows/pages.ts, the app's windows/browser/pageReader.ts):
// as Markdown, or what a CSS selector or an XPath matches; and acting on it (click, fill, submit). The page lives in the app, so the core
// asks it (browser.request) and the app window showing it answers (browser.reply).

import type { WindowId } from "./model.ts";

/** markdown: the page (or the first match of `selector`) as Markdown; css, xpath: what `selector` matches, listed. */
export type PageReadMode = "markdown" | "css" | "xpath";

export interface PageRead {
  url: string;
  title: string;
  text: string;
  /** css, xpath: how many matched (the text lists the first few). */
  matches?: number;
  /** The text was cut at `max`. */
  cut?: boolean;
}

/** click: the element; fill: type `value` into a field; select: pick the option `value`; submit: its form; press: a key (enter, escape, tab) on it. */
export type PageAction = "click" | "fill" | "select" | "submit" | "press";

/** What an action is about, as the page describes it, and where the page is after it. */
export interface PageActed {
  url: string;
  title: string;
  /** The element in a line: its tag, label, text ("<button> Sign in"). */
  element: string;
  /** A password, card or one-time-code field: never typed into. */
  sensitive?: boolean;
}

/**
 * Read a browser window's page and answer with browser.reply, or act on it and answer with
 * browser.acted (the app window showing it does). Part of CoreEvent (rpc.ts).
 */
export type PagesEvent =
  | { type: "browser.request"; reqId: string; id: WindowId; mode: PageReadMode; selector?: string; max: number }
  | { type: "browser.actRequest"; reqId: string; id: WindowId; action: PageAction; selector: string; index?: number; value?: string; dry?: boolean };

/** Page reading's RPC methods, part of `Methods` (rpc.ts). */
export interface PagesMethods {
  /**
   * What a browser window's page shows: as Markdown (of the page, or of the first element `selector`
   * matches), or the elements a CSS selector or the nodes an XPath matches, each with its text and
   * attributes. The app window showing it answers (browser.request → browser.reply); fails when none does.
   */
  "browser.read": { params: { id: WindowId; mode: PageReadMode; selector?: string; max?: number }; result: PageRead };
  /** The app's answer to a browser.request event. */
  "browser.reply": { params: { reqId: string; result?: PageRead; error?: string }; result: null };
  /**
   * Act on a browser window's page: on the element `selector` matches (the `index`th, from 1, when
   * several do). `dry`: only find and describe it (and outline it on the page), for an approval.
   */
  "browser.act": { params: { id: WindowId; action: PageAction; selector: string; index?: number; value?: string; dry?: boolean }; result: PageActed };
  /** The app's answer to a browser.actRequest event. */
  "browser.acted": { params: { reqId: string; result?: PageActed; error?: string }; result: null };
}
