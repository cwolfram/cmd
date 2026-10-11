// What a Magic change asks the model for (refineRequest): the person's earlier
// requests and the new change, so a refinement keeps what they asked before.

import type { MagicState } from "@cmd/protocol";

/**
 * A change's request: everything the person asked so far (the first request
 * and each change, in order, so details from any of them survive) and the new
 * change. The widget's current files go into the request separately. A v1
 * window (no widget folder yet) brings its old view, to be rebuilt as a widget.
 */
export function refineRequest(prev: MagicState, change: string): string {
  const asked = prev.history?.length ? prev.history : [prev.prompt];
  const earlier = asked.length === 1 ? `The window was made from this request:\n${asked[0]}` : `The window was made from these requests, in order (the first, then changes):\n${asked.map((r, i) => `${i + 1}. ${r}`).join("\n")}`;
  const legacy = !prev.widgetId
    ? prev.kind === "terminal" && prev.command
      ? `It currently offers the terminal command: ${prev.command}`
      : prev.html
        ? `It was made before widgets had files of their own: rebuild it as a widget (manifest.json, data.ts, view.html, view.ts).${prev.source ? `\nIts data came from ${prev.source.type === "fetch" ? `GET ${prev.source.url}` : `the command: ${prev.source.command}`}` : ""}\nIts old view:\n${prev.html}`
        : ""
    : "";
  return [earlier, `Change it as asked, keeping what still fits and everything those requests asked for that the change doesn't override: ${change}`, legacy].filter(Boolean).join("\n\n");
}
