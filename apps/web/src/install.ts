// Which hint the pairing link's screen gives for installing cmd as an app
// first. It only picks the words: every browser pairs the same way, when the
// person taps Pair This Browser. An installed app keeps its own storage on iOS
// (and in Safari's Add to Dock), so a pairing made in the tab may not reach
// it; the app pairs by scanning a fresh code instead. Chromium offers its
// install prompt through beforeinstallprompt, which fires at load, so it's
// kept from the moment this module loads.

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
// globalThis, not window: tests import installHint outside a browser.
globalThis.addEventListener?.("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e as InstallPrompt;
  listeners.forEach((fn) => fn());
});
globalThis.addEventListener?.("appinstalled", () => {
  deferred = null;
  listeners.forEach((fn) => fn());
});

export const onInstallChange = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn));

/** Shows the browser's own install prompt; true when the person installed. */
export async function promptInstall(): Promise<boolean> {
  const p = deferred;
  if (!p) return false;
  deferred = null;
  await p.prompt();
  const { outcome } = await p.userChoice;
  listeners.forEach((fn) => fn());
  return outcome === "accepted";
}

export type InstallHint = "ios" | "prompt" | null;

/** No hint inside an installed app; iOS gets Add to Home Screen steps, Chromium its install button. */
export function installHint(o: { ua: string; touchPoints: number; standalone: boolean; canPrompt: boolean }): InstallHint {
  if (o.standalone) return null;
  if (/iPhone|iPad|iPod/.test(o.ua) || (/Macintosh/.test(o.ua) && o.touchPoints > 1)) return "ios";
  return o.canPrompt ? "prompt" : null;
}

/** This page's install hint. */
export function installHintHere(): InstallHint {
  const standalone = (navigator as { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches;
  return installHint({ ua: navigator.userAgent, touchPoints: navigator.maxTouchPoints, standalone, canPrompt: deferred !== null });
}
