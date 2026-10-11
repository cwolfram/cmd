// Whether an Option+key press is Meta (Escape+key) or types what the layout puts
// there (terminal.optionAsMeta). Pure, for tests.

export type OptionMode = "both" | "left" | "right" | "off";

/**
 * Meta for this key? Left or Right: only that Option key, always. Both (the
 * default) leaves the keys that type ASCII to the layout: ⌥L is @, ⌥5 [ and ⌥7 |
 * on German and most European Mac layouts, and nothing of the sort can be typed
 * without Option there. A US layout's Option keys type only non-ASCII (¬ ∫ ƒ…),
 * so they all stay Meta. `key` is the KeyboardEvent's key, with Option applied.
 */
export function optionIsMeta(mode: OptionMode, side: "left" | "right" | null, key: string): boolean {
  if (mode === "off") return false;
  if (mode !== "both") return mode === side;
  return !(key.length === 1 && key >= "!" && key <= "~" && !/[a-z0-9]/i.test(key)) && key !== "€";
}
