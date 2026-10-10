// This browser's pairings, one per Mac, kept in IndexedDB under the Mac's host
// key (base64url): the device's X25519 key wrapped by a non-extractable AES key,
// the Mac's public key, where to reach it, its name and when it was last used.
// WebKit stores an X25519 CryptoKey but reads it back as null (the whole
// record), so the key is kept wrapped and unwrapped non-extractable on load.
// Nothing secret is ever in a URL after pairing. Pairings saved before direct
// modes keep the socket as `relay`; loading reads it as `socket`, and ones
// saved with the bare CryptoKey (Chromium) still load. The single pairing kept
// under `mac` before there could be several moves to its host key on first list.

import { toBase64Url, type KeyPair } from "@cmd/remote-crypto";

const subtle = globalThis.crypto.subtle;

export interface Identity {
  device: KeyPair;
  hostKey: Uint8Array<ArrayBuffer>;
  /** The WebSocket base it dials (Pairing.socket): the relay, or the Mac's own address. */
  socket: string;
  route: string;
  deviceId: string;
  /** The Mac's name, from its bootstrap once connected. */
  name?: string;
  lastUsed?: number;
}

/** A paired Mac as a list shows it; `key` is its host key in base64url. */
export interface Mac {
  key: string;
  name: string;
  lastUsed: number;
}

const DB = "cmd-remote";
const STORE = "identity";
const LEGACY = "mac";

export const macKey = (hostKey: Uint8Array): string => toBase64Url(hostKey);

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** As stored: the device key wrapped (`wrapped` under `wrapKey`), or a bare CryptoKey from before. */
export interface Stored extends Omit<Identity, "device" | "socket"> {
  socket?: string;
  relay?: string;
  device?: KeyPair;
  wrapKey?: CryptoKey;
  iv?: Uint8Array<ArrayBuffer>;
  wrapped?: Uint8Array<ArrayBuffer>;
  publicKey?: Uint8Array<ArrayBuffer>;
}

/**
 * What to change so every pairing sits under its host key: the legacy `mac`
 * record moves to its key unless that key already holds a pairing (newer, so
 * it wins), and is dropped either way.
 */
export function migration(entries: [IDBValidKey, Stored | null | undefined][]): { put: [string, Stored][]; drop: string[] } {
  const legacy = entries.find(([k]) => k === LEGACY);
  if (!legacy) return { put: [], drop: [] };
  const rec = legacy[1];
  if (!rec?.hostKey) return { put: [], drop: [LEGACY] };
  const key = macKey(rec.hostKey);
  const taken = entries.some(([k, v]) => k === key && v);
  return { put: taken ? [] : [[key, rec]], drop: [LEGACY] };
}

/** The paired Macs, most recently used first. */
export function macsOf(entries: [IDBValidKey, Stored | null | undefined][]): Mac[] {
  return entries
    .filter((e): e is [string, Stored] => typeof e[0] === "string" && e[0] !== LEGACY && !!e[1]?.hostKey)
    .map(([key, s]) => ({ key, name: s.name || "Mac", lastUsed: s.lastUsed ?? 0 }))
    .sort((a, b) => b.lastUsed - a.lastUsed || a.name.localeCompare(b.name));
}

/** Every record with its key, read in one go; WebKit's unreadable ones come back null. */
async function entries(): Promise<[IDBValidKey, Stored | null][]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const out: [IDBValidKey, Stored | null][] = [];
    const req = db.transaction(STORE, "readonly").objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(out);
      out.push([c.key, (c.value as Stored | null) ?? null]);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/** The paired Macs, most recently used first; moves a legacy pairing to its key first. */
export async function listMacs(): Promise<Mac[]> {
  let all = await entries();
  const m = migration(all);
  if (m.put.length || m.drop.length) {
    for (const [k, v] of m.put) await tx("readwrite", (s) => s.put(v, k));
    for (const k of m.drop) await tx("readwrite", (s) => s.delete(k));
    all = await entries();
  }
  return macsOf(all);
}

const AES = (iv: Uint8Array<ArrayBuffer>) => ({ name: "AES-GCM", iv });

export async function loadIdentity(key: string): Promise<Identity | undefined> {
  const d = await tx<Stored | undefined>("readonly", (s) => s.get(key));
  if (!d) return undefined;
  const { relay, socket, device, wrapKey, iv, wrapped, publicKey, ...rest } = d;
  let kp = device;
  if (wrapKey && iv && wrapped && publicKey) {
    const privateKey = await subtle.unwrapKey("pkcs8", wrapped, wrapKey, AES(iv), { name: "X25519" }, false, ["deriveBits"]);
    kp = { privateKey, publicKey };
  }
  if (!kp) return undefined;
  return { ...rest, device: kp, socket: socket ?? relay ?? "" };
}

/** Saves a pairing, replacing any for the same Mac; the device key must be extractable (it is wrapped, never stored readable). */
export async function saveIdentity(id: Identity): Promise<void> {
  const { device, ...rest } = id;
  const wrapKey = await subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["wrapKey", "unwrapKey"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = new Uint8Array(await subtle.wrapKey("pkcs8", device.privateKey, wrapKey, AES(iv)));
  const stored: Stored = { ...rest, wrapKey, iv, wrapped, publicKey: device.publicKey };
  await tx("readwrite", (s) => s.put(stored, macKey(id.hostKey)));
}

/** Updates a pairing's name or last use; the key stays as it was wrapped. */
export async function touchIdentity(key: string, patch: { name?: string; lastUsed?: number }): Promise<void> {
  const d = await tx<Stored | undefined>("readonly", (s) => s.get(key));
  if (!d || (patch.name === undefined || patch.name === d.name) && patch.lastUsed === undefined) return;
  await tx("readwrite", (s) => s.put({ ...d, ...patch }, key));
}

export const forgetIdentity = (key: string) => tx("readwrite", (s) => s.delete(key)).then(() => {});

/** What the Mac shows in its approval sheet. */
export function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad|Macintosh.*Mobile/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  const browser = /Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "a computer";
  return `${browser} on ${os}`;
}
