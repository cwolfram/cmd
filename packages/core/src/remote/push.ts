// The Mac's notifications on paired devices (docs/13-remote-access.md, "Push notifications"):
// each device's push subscription (kept on its record), whether someone's at this Mac (the
// app's ui.presence reports, and typing in a terminal here), and sending: every notification
// the Mac shows, while remote access is on and remote.push.when says so, to each subscribed
// device not showing cmd in front. Sending itself is webpush.ts. RemoteService (`core.remote.push`)
// owns one and hands it the host's keys and which devices are looking.

import type { AppNotification } from "@cmd/protocol";
import { logger } from "@cmd/protocol/node";
import { toBase64Url, type Bytes } from "@cmd/remote-crypto";
import type { Connection } from "../kernel/connection.ts";
import type { SettingsService } from "../kernel/settings.ts";
import type { RemoteDeviceRecord, Store } from "../kernel/store.ts";
import { sendPush, SubscriptionGone, vapidPublicKey, type PushSubscriptionData, type VapidKeys } from "./webpush.ts";

const log = logger("remote");

/** Who sends our pushes, for the push services (VAPID's subject). */
const PUSH_SUBJECT = "https://github.com/janoelze/cmd";
/** How long a push service keeps a notification for a phone that's offline: later than this it's old news. */
const PUSH_TTL_S = 3600;
/** A push's title and body are cut to these, so the payload always fits one record. */
const PUSH_TITLE_MAX = 120;
const PUSH_BODY_MAX = 600;

export interface PushHost {
  store: Store;
  settings: SettingsService;
  /** This Mac's host key (devices know it by it) and its VAPID keys; null before they're loaded. */
  keys(): { host: Bytes; vapid: VapidKeys } | null;
  /** Devices showing cmd in front right now (push.visible): they show notifications themselves. */
  looking(): Set<string | null>;
  audit(kind: string, deviceId: string | null, detail: string | null): void;
  /** The device list changed (who gets notifications). */
  changed(): void;
}

export class RemotePush {
  #o: PushHost;
  /** The app on this Mac (ui.presence, from its main process): when it last saw input, and whether the screen is locked. */
  #presence: { conn: Connection | null; inputAt: number; locked: boolean } | null = null;
  /** Someone last typed into a terminal here (pane.write from this Mac). */
  #typedAt = 0;

  constructor(o: PushHost) {
    this.#o = o;
  }

  /** What remote.bootstrap tells a device: the key to subscribe with, and whether it has. */
  info(deviceId: string): { key: string; subscribed: boolean } | null {
    const k = this.#o.keys();
    return k && { key: vapidPublicKey(k.vapid), subscribed: !!this.#device(deviceId)?.push };
  }

  /** A device's push subscription (push.subscribe); replaces the one it had. */
  subscribe(conn: Connection, sub: PushSubscriptionData): void {
    const d = this.#device(conn.deviceId);
    if (!d) throw new Error("only paired devices get notifications");
    this.#o.store.saveRemoteDevice({ ...d, push: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } } });
    if (d.push?.endpoint !== sub.endpoint) this.#o.audit("push-on", d.id, new URL(sub.endpoint).hostname);
    this.#o.changed();
  }

  unsubscribe(conn: Connection): void {
    const d = this.#device(conn.deviceId);
    if (!d) throw new Error("only paired devices get notifications");
    this.#drop(d.id, "push-off");
  }

  /** The app's report (ui.presence); it belongs to its connection (null: from inside the core). */
  presence(conn: Connection | null, p: { idleSeconds: number; locked: boolean }): void {
    const idle = Number.isFinite(p.idleSeconds) ? Math.max(0, p.idleSeconds) : 0;
    if (this.#presence?.conn !== conn) log.info("the app reports whether you're at this Mac");
    this.#presence = { conn, inputAt: Date.now() - idle * 1000, locked: p.locked === true };
  }

  /** Someone typed into a terminal from this Mac: input, like the app's own report. */
  typed(): void {
    this.#typedAt = Date.now();
  }

  /** A connection closed: when it was the app's, nobody reports anymore (the app quit). */
  closed(conn: Connection): void {
    if (this.#presence?.conn !== conn) return;
    this.#presence = null;
    log.info("the app stopped reporting: away");
  }

  /**
   * Nobody's at this Mac (remote.push.when "away"): the app isn't running, the
   * screen is locked, or there's been no input (typing in a terminal here
   * counts) for remote.push.awayMinutes.
   */
  away(now = Date.now()): boolean {
    const p = this.#presence;
    if (!p || p.locked) return true;
    return now - Math.max(p.inputAt, this.#typedAt) >= this.#o.settings.settings["remote.push.awayMinutes"] * 60_000;
  }

  /**
   * Sends a notification the Mac shows (alert set) to every device that
   * subscribed, while remote access is on and remote.push.when says so; not to
   * one showing the client in front, which shows the notification event itself.
   * remote.pushDetails off sends the title alone.
   */
  notify(n: AppNotification): void {
    const s = this.#o.settings.settings;
    const k = this.#o.keys();
    if (!n.alert || !k || !s["remote.enabled"] || s["remote.push.when"] === "never") return;
    if (s["remote.push.when"] === "away" && !this.away()) return;
    const looking = this.#o.looking();
    const devices = this.#o.store.remoteDevices().filter((d) => d.push && !looking.has(d.id));
    if (!devices.length) return;
    const payload = new TextEncoder().encode(
      JSON.stringify({
        host: toBase64Url(k.host),
        id: n.id,
        title: cut(n.title, PUSH_TITLE_MAX),
        body: s["remote.pushDetails"] ? cut(n.body, PUSH_BODY_MAX) : "",
        paneId: n.paneId,
        windowId: n.windowId ?? null,
        workspaceId: n.workspaceId ?? null,
        urgent: n.urgent,
        at: n.at,
      }),
    );
    for (const d of devices) {
      sendPush(d.push!, payload, { keys: k.vapid, subject: PUSH_SUBJECT, ttl: PUSH_TTL_S, urgency: n.urgent ? "high" : "normal" }).catch((err) => {
        if (err instanceof SubscriptionGone) this.#drop(d.id, "push-gone");
        else log.warn(`push to ${d.name} failed: ${(err as Error).message}`);
      });
    }
  }

  #device(id: string | null | undefined): RemoteDeviceRecord | undefined {
    return id ? this.#o.store.remoteDevices().find((d) => d.id === id) : undefined;
  }

  #drop(id: string, kind: string): void {
    const d = this.#device(id);
    if (!d?.push) return;
    const { push: _, ...rest } = d;
    this.#o.store.saveRemoteDevice(rest);
    this.#o.audit(kind, id, null);
    this.#o.changed();
  }
}

/** At most `max` characters, with an ellipsis when cut. */
function cut(s: string, max: number): string {
  const chars = Array.from(s); // never half an emoji
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join("")}…`;
}
