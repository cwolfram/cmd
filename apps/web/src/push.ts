// Notifications on this device (docs/13-remote-access.md, "Push
// notifications"): Web Push from each paired Mac. A subscription belongs to the
// key it was made with, and each Mac signs with its own, so every Mac gets its
// own registration of sw.js (scope /m/<host key>/) and its own subscription.
// Having that registration is what "on" means for a Mac. Each connection
// checks it again (subscriptions get dropped, a Mac's key can change) and tells
// the Mac whether the page is in front, when it shows notifications itself.

import { fromBase64Url, toBase64Url } from "@cmd/remote-crypto";
import type { Result } from "@cmd/protocol";
import type { Connection } from "./connection.ts";
import { installHintHere } from "./install.ts";

/**
 * on, off; denied: blocked in the browser's settings; install: iOS shows them
 * only for the Home Screen app; unsupported: this browser can't; old: the Mac's
 * cmd doesn't send them yet.
 */
export type PushState = "on" | "off" | "denied" | "install" | "unsupported" | "old";

type PushInfo = Result<"remote.bootstrap">["push"];

const scopeOf = (mac: string) => `/m/${mac}/`;

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

async function registration(mac: string): Promise<ServiceWorkerRegistration | undefined> {
  const reg = await navigator.serviceWorker.getRegistration(scopeOf(mac));
  // getRegistration matches by URL: only this Mac's own counts.
  return reg && new URL(reg.scope).pathname === scopeOf(mac) ? reg : undefined;
}

export async function pushState(mac: string, push: PushInfo): Promise<PushState> {
  // An iOS tab: push is only for the Home Screen app, whatever the tab exposes.
  if (installHintHere() === "ios") return "install";
  if (!supported()) return "unsupported";
  if (!push) return "old";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  const sub = await (await registration(mac))?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

/** Asks for permission (call it from a tap), then subscribes with this Mac's key and tells the Mac. */
export async function enablePush(conn: Connection, push: NonNullable<PushInfo>): Promise<PushState> {
  // First, before any other await: Safari only asks in direct answer to a tap.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: scopeOf(conn.key) });
  await active(reg);
  await send(conn, await subscription(reg, push.key));
  return "on";
}

/** Unsubscribes, drops this Mac's registration, and tells the Mac when connected. */
export async function disablePush(conn: Connection): Promise<void> {
  const reg = await registration(conn.key);
  await (await reg?.pushManager.getSubscription())?.unsubscribe();
  await reg?.unregister();
  await conn.client?.call("push.unsubscribe", {}).catch(() => {});
}

/** Forgetting a Mac: its registration goes too (the Mac no longer knows this browser). */
export async function forgetPush(mac: string): Promise<void> {
  if (!supported()) return;
  await (await registration(mac))?.unregister();
}

/**
 * On every connection: a Mac this browser turned notifications on for gets
 * the current subscription (made again if it went or the Mac's key changed);
 * one whose permission was taken back is told to stop.
 */
export async function syncPush(conn: Connection, push: PushInfo): Promise<void> {
  if (!push || !supported()) return;
  const reg = await registration(conn.key);
  if (!reg) {
    if (push.subscribed) await conn.client?.call("push.unsubscribe", {});
    return;
  }
  if (Notification.permission !== "granted") {
    if (push.subscribed) await conn.client?.call("push.unsubscribe", {});
    return;
  }
  await active(reg);
  await send(conn, await subscription(reg, push.key));
}

/** The registration's subscription with this key: the one it has, or a new one. */
async function subscription(reg: ServiceWorkerRegistration, key: string): Promise<PushSubscription> {
  const had = await reg.pushManager.getSubscription();
  const hadKey = had?.options.applicationServerKey;
  if (had && hadKey && toBase64Url(new Uint8Array(hadKey)) === key) return had;
  await had?.unsubscribe();
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(key) });
}

async function send(conn: Connection, sub: PushSubscription): Promise<void> {
  const { endpoint, keys } = sub.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error("the browser gave an incomplete subscription");
  await conn.client?.call("push.subscribe", { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
}

/** Subscribing needs an active worker; a fresh registration is still installing. */
function active(reg: ServiceWorkerRegistration): Promise<void> {
  if (reg.active) return Promise.resolve();
  const w = reg.installing ?? reg.waiting;
  if (!w) return Promise.reject(new Error("the service worker didn't install"));
  return new Promise((resolve, reject) => {
    w.addEventListener("statechange", () => {
      if (w.state === "activated") resolve();
      else if (w.state === "redundant") reject(new Error("the service worker didn't install"));
    });
  });
}

/** What a notification the person tapped asks to open: a Mac and maybe a terminal. */
export interface OpenRequest {
  mac: string;
  paneId: string | null;
}

/** The request in this page's address (a tap that opened a new window), taken out of it. */
export function openRequestFromUrl(): OpenRequest | null {
  const q = new URLSearchParams(location.search);
  const mac = q.get("mac");
  if (!mac) return null;
  history.replaceState(null, "", "/");
  return { mac, paneId: q.get("pane") };
}

/** Taps on a notification while this page is open (the service worker posts them). */
export function onOpenRequest(fn: (r: OpenRequest) => void): () => void {
  if (!("serviceWorker" in navigator)) return () => {};
  const on = (e: MessageEvent) => {
    const d = e.data as { type?: string; mac?: string; paneId?: string | null } | null;
    if (d?.type === "cmd.open" && typeof d.mac === "string") fn({ mac: d.mac, paneId: d.paneId ?? null });
  };
  navigator.serviceWorker.addEventListener("message", on);
  navigator.serviceWorker.startMessages();
  return () => navigator.serviceWorker.removeEventListener("message", on);
}
