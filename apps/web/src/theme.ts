// The Mac's theme on the phone: its theme.* settings come with the bootstrap
// and as theme.updated (the policy lets no other setting through). Auto follows
// this phone's appearance with the Mac's dark and light picks, as Auto on the
// Mac follows the Mac's. Before the first connection: the theme the last visit
// used, else the default picks for the phone's appearance.

import "@cmd/ui/themes/builtin";
import { applyTheme, currentTheme, onThemeChange, resolveTheme, themeFor } from "@cmd/ui/themes";
import { SETTINGS_SCHEMA, type RemoteTheme } from "@cmd/protocol";

const systemDark = matchMedia("(prefers-color-scheme: dark)");
/** A Mac on cmd 0.24 or older sends no theme: its defaults. */
const DEFAULT: RemoteTheme = { appearance: "auto", dark: SETTINGS_SCHEMA["theme.dark"].default, light: SETTINGS_SCHEMA["theme.light"].default };
let mac: RemoteTheme | null = null;

function sync(): void {
  const t = mac ?? DEFAULT;
  const appearance = t.appearance === "auto" ? (systemDark.matches ? "dark" : "light") : t.appearance;
  applyTheme(resolveTheme(appearance, t.dark, t.light));
}

/** Paint in the last visit's theme (or the defaults), then follow the phone's appearance where Auto. */
export function startTheme(): void {
  let id: string | null = null;
  try {
    id = localStorage.getItem("cmd.theme");
  } catch {}
  const last = id ? themeFor(id) : undefined;
  if (last) applyTheme(last);
  else sync();
  systemDark.addEventListener("change", sync);
  // The browser's bars (Safari's, a home-screen app's status bar) in the theme's background.
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const paint = () => meta?.setAttribute("content", currentTheme().colors.bg);
  onThemeChange(paint);
  paint();
}

/** The Mac's theme settings, from the bootstrap (undefined from an older Mac) or theme.updated. */
export function setMacTheme(t: RemoteTheme | undefined): void {
  mac = t ?? DEFAULT;
  sync();
}
