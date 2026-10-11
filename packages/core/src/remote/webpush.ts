// Web Push from the core itself (docs/13, "Push notifications"): no push
// server of our own and no relay. A payload is encrypted to the browser's
// subscription (RFC 8291, aes128gcm, RFC 8188), so the push service (Apple,
// Google, Mozilla) sees only that a push happened, and the request is signed
// with the host's VAPID key (RFC 8292), which the browser pinned when it
// subscribed. Everything is node:crypto and fetch.

import crypto from "node:crypto";

/** What PushManager.subscribe() gave the browser, as its toJSON() has it. */
export interface PushSubscriptionData {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** A P-256 key pair for VAPID, as JWK (kept in host.json). */
export type VapidKeys = { publicKey: crypto.JsonWebKey; privateKey: crypto.JsonWebKey };

/** A push the service refused for good: the subscription is gone (404, 410) and must be dropped. */
export class SubscriptionGone extends Error {}

/** Records are one per push: the payload plus its delimiter and tag fit one record of this size. */
const RECORD_SIZE = 4096;
/** The most plaintext one record holds (4096 - 16 tag - 1 delimiter). */
export const MAX_PAYLOAD = RECORD_SIZE - 17;
/** How long a VAPID token is good for (the spec allows up to 24 h). */
const TOKEN_TTL_S = 12 * 3600;

const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const unb64u = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

export function generateVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { publicKey: publicKey.export({ format: "jwk" }), privateKey: privateKey.export({ format: "jwk" }) };
}

/** The public key as the browser's applicationServerKey wants it: uncompressed P-256, base64url. */
export function vapidPublicKey(keys: VapidKeys): string {
  const { x, y } = keys.publicKey;
  if (!x || !y) throw new Error("not a P-256 public key");
  return b64u(Buffer.concat([Buffer.from([4]), Buffer.from(x, "base64url"), Buffer.from(y, "base64url")]));
}

/** The Authorization header for a push to `endpoint`: a JWT for its origin, signed ES256. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): string {
  const enc = (o: object) => b64u(Buffer.from(JSON.stringify(o)));
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + TOKEN_TTL_S, sub: subject })}`;
  const key = crypto.createPrivateKey({ key: keys.privateKey, format: "jwk" });
  const sig = crypto.sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${b64u(sig)}, k=${vapidPublicKey(keys)}`;
}

/**
 * Encrypts a payload to a subscription as one aes128gcm record: salt, record
 * size, our ephemeral public key, ciphertext. `salt` and `ephemeral` are for
 * tests; a real push gets fresh ones.
 */
export function encryptPayload(payload: Uint8Array, sub: PushSubscriptionData, o: { salt?: Uint8Array; ephemeral?: crypto.ECDH } = {}): Uint8Array<ArrayBuffer> {
  if (payload.length > MAX_PAYLOAD) throw new Error(`push payload too big (${payload.length} bytes)`);
  const uaPublic = unb64u(sub.keys.p256dh);
  const authSecret = unb64u(sub.keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("bad p256dh key");
  if (authSecret.length !== 16) throw new Error("bad auth secret");
  const ecdh = o.ephemeral ?? crypto.createECDH("prime256v1");
  if (!o.ephemeral) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = o.salt ?? crypto.randomBytes(16);
  // RFC 8291 §3.4: the input keying material binds both public keys and the auth secret.
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  // 0x02: the last (and only) record, no padding.
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  Buffer.from(salt).copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return new Uint8Array(Buffer.concat([header, asPublic, body]));
}

export interface PushOptions {
  keys: VapidKeys;
  /** Who runs this sender, for the push service (mailto: or https:). */
  subject: string;
  /** Seconds the push service keeps it for a phone that's offline. */
  ttl: number;
  urgency: "high" | "normal";
  /** Tests stand in a fake push service. */
  fetch?: typeof fetch;
}

/** Sends one push. Throws SubscriptionGone when the service says the subscription no longer exists. */
export async function sendPush(sub: PushSubscriptionData, payload: Uint8Array, o: PushOptions): Promise<void> {
  const res = await (o.fetch ?? fetch)(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: vapidAuthorization(sub.endpoint, o.keys, o.subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(o.ttl),
      Urgency: o.urgency,
    },
    body: encryptPayload(payload, sub),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404 || res.status === 410) throw new SubscriptionGone(`push subscription gone (${res.status})`);
  if (!res.ok) throw new Error(`push failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
}

/**
 * The browsers' push services. A device names the URL the Mac posts to, so it
 * may only be one of these: a paired phone can't make the Mac send requests
 * into its own network.
 */
const PUSH_HOSTS = [
  /(^|\.)push\.apple\.com$/, // Safari
  /^(fcm|android)\.googleapis\.com$/, // Chrome, Edge on Android, Samsung
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^[a-z0-9-]+\.notify\.windows\.com$/, // Edge on Windows
];

/** Whether an endpoint is one a browser could have handed out: https on a known push service, no credentials. */
export function validEndpoint(endpoint: string, hosts: readonly RegExp[] = PUSH_HOSTS): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.port && !u.username && !u.password && endpoint.length <= 2048 && hosts.some((h) => h.test(u.hostname));
  } catch {
    return false;
  }
}
