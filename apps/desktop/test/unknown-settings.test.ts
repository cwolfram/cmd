// @vitest-environment happy-dom
// The Settings window's note for keys in settings.json cmd doesn't know: one per
// key, and Remove asks to take that key out (AR1-15-04).
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { UnknownSettings } from "../src/renderer/src/settings/UnknownSettings.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

it("shows each unknown key with a Remove button that removes that key", async () => {
  const el = document.createElement("div");
  document.body.append(el);
  const onRemove = vi.fn();
  const root = createRoot(el);
  await act(async () => root.render(h(UnknownSettings, { keys: ["canvas.zoomz", "old.thing"], onRemove })));
  const notes = [...el.querySelectorAll(".ui-callout")];
  expect(notes.map((n) => n.textContent)).toEqual([expect.stringContaining("“canvas.zoomz”"), expect.stringContaining("“old.thing”")]);
  await act(async () => (notes[1]!.querySelector("button") as HTMLButtonElement).click());
  expect(onRemove).toHaveBeenCalledWith("old.thing");
  await act(async () => root.render(h(UnknownSettings, { keys: [], onRemove })));
  expect(el.querySelectorAll(".ui-callout")).toHaveLength(0);
  root.unmount();
});
