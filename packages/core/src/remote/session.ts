// One device's channel on the relay link, host side: the Noise handshake (IK for
// a paired device, IKpsk1 for pairing, which waits for the person on the Mac),
// then a Connection the core serves like a socket client. Its writer coalesces
// terminal output per pane and, when the device falls behind, drops it and asks
// the device to resync from a snapshot instead of buffering without bound.

import type { CoreEvent, RemoteScope } from "@cmd/protocol";
import { fingerprint, frame, Handshake, LineOpener, PROLOGUE, sealLine, unframe, utf8, Wire, type Bytes, type KeyPair, type Transport } from "@cmd/remote-crypto";
import type { Connection, Served } from "../kernel/connection.ts";
import { ConnectionWriter } from "../kernel/writer.ts";

/** Merge a pane's output for this long before sending it. */
const COALESCE_MS = 30;
/** How long a session waits for the device's first message after the handshake. */
export const CONFIRM_MS = 10_000;

export interface ChannelHost {
  key: KeyPair;
  version: string;
  /** A paired device by its public key, or null. */
  device(publicKey: Bytes): { id: string; scope: RemoteScope } | null;
  /** A device's session is confirmed: it's been seen now (its expiry moves). */
  seen(deviceId: string): void;
  /** The pairing link in effect, or null; usePairing() takes it once its PSK proved right (false: someone else did). */
  pairing(): { psk: Bytes; scope: RemoteScope } | null;
  usePairing(p: { psk: Bytes; scope: RemoteScope }): boolean;
  /** Ask the person on the Mac; resolves with the scope to pair with, or null for no (or when `signal` aborts: the device left). */
  approve(name: string, words: string[], scope: RemoteScope, signal: AbortSignal): Promise<RemoteScope | null>;
  /** Store a newly paired device. */
  addDevice(name: string, publicKey: Bytes, scope: RemoteScope): { id: string };
  /** A handshake failed (wrong key, wrong PSK, junk, no message after it), from `ip`. */
  failed(reason: string, ip: string): void;
  /** The session is up: serve it. */
  serve(conn: Connection, session: HostChannel): Served;
  opened(session: HostChannel): void;
}

export class HostChannel {
  readonly channel: number;
  readonly ip: string;
  readonly user: string | null;
  deviceId: string | null = null;
  scope: RemoteScope | null = null;
  since = 0;
  /** Windows the device follows (window.follow). */
  watching: string[] = [];
  #host: ChannelHost;
  #send: (b: Bytes) => void;
  #drop: () => void;
  /** confirming: the handshake is done and the device's first message hasn't come (message 1 can be replayed, IK has no freshness). */
  #state: "hello" | "busy" | "confirming" | "open" | "closed" = "hello";
  #transport: Transport | null = null;
  #confirm: ReturnType<typeof setTimeout> | null = null;
  #opener: LineOpener | null = null;
  #served: Served | null = null;
  #in: Promise<void> = Promise.resolve();
  #gone = new AbortController();

  #confirmMs: number;

  /** confirmMs: how long the device has for its first message (tests). */
  constructor(o: { channel: number; ip: string; user?: string | null; host: ChannelHost; send: (b: Bytes) => void; drop: () => void; confirmMs?: number }) {
    this.#confirmMs = o.confirmMs ?? CONFIRM_MS;
    this.channel = o.channel;
    this.ip = o.ip;
    this.user = o.user ?? null;
    this.#host = o.host;
    this.#send = o.send;
    this.#drop = o.drop;
  }

  /** A message from the device; processed strictly in order. Anything malformed ends the channel. */
  receive(msg: Bytes): void {
    this.#in = this.#in
      .then(() => this.#receive(msg))
      .catch((err: Error) => {
        if (this.#state !== "open") this.#host.failed(err.message, this.ip);
        this.close();
      });
  }

  async #receive(msg: Bytes): Promise<void> {
    if (this.#state === "closed") return;
    const f = unframe(msg);
    if (this.#state === "open" || this.#state === "confirming") {
      if (f.kind !== Wire.data) throw new Error("unexpected frame");
      const line = await this.#opener!.open(f.body);
      // It decrypted: the device holds the session's keys, so it's no replay.
      if (this.#state === "confirming") this.#confirmed();
      if (line !== null) this.#served?.receive(line);
      return;
    }
    if (this.#state !== "hello") throw new Error("message during the handshake");
    this.#state = "busy";
    if (f.kind === Wire.hello) await this.#session(f.body);
    else if (f.kind === Wire.pair) await this.#pair(f.body);
    else throw new Error("expected a handshake");
  }

  /** A paired device: IK, and its key must be on the list. */
  async #session(m1: Bytes): Promise<void> {
    const hs = await Handshake.create({ pattern: "IK", initiator: false, s: this.#host.key, prologue: PROLOGUE });
    await hs.readMessage(m1);
    const d = this.#host.device(hs.remoteStatic!);
    if (!d) throw new Error("unknown device key");
    await this.#open(hs, d.id, d.scope);
  }

  /** Pairing: the QR's PSK (single use, once it proved right), then the person on the Mac decides. */
  async #pair(m1: Bytes): Promise<void> {
    const pairing = this.#host.pairing();
    if (!pairing) throw new Error("no pairing in progress");
    const hs = await Handshake.create({ pattern: "IKpsk1", initiator: false, s: this.#host.key, psk: pairing.psk, prologue: PROLOGUE });
    const hello = parseHello(await hs.readMessage(m1));
    if (!this.#host.usePairing(pairing)) throw new Error("the pairing link was used");
    const scope = await this.#host.approve(hello.name, fingerprint(hs.hash), pairing.scope, this.#gone.signal);
    if (this.#state === "closed") return;
    if (!scope) return this.close(); // the person said no: not a failed handshake
    const { id } = this.#host.addDevice(hello.name, hs.remoteStatic!, scope);
    await this.#open(hs, id, scope);
  }

  /** The reply; the session opens with the device's first message (confirmed), or the channel closes after CONFIRM_MS. */
  async #open(hs: Handshake, deviceId: string, scope: RemoteScope): Promise<void> {
    this.#send(frame(Wire.reply, await hs.writeMessage(utf8(JSON.stringify({ deviceId, scope, version: this.#host.version })))));
    this.#transport = await hs.transport();
    this.#opener = new LineOpener(this.#transport);
    this.deviceId = deviceId;
    this.scope = scope;
    this.#state = "confirming";
    this.#confirm = setTimeout(() => {
      this.#host.failed("no message after the handshake (a replay?)", this.ip);
      this.close();
    }, this.#confirmMs);
    this.#confirm.unref?.();
  }

  #confirmed(): void {
    clearTimeout(this.#confirm!);
    this.#confirm = null;
    this.#state = "open";
    this.since = Date.now();
    this.#host.seen(this.deviceId!);
    this.#served = this.#host.serve(new RemoteConnection(this.#transport!, this.scope!, this.deviceId!, (b) => this.#send(b), () => this.close()), this);
    this.#host.opened(this);
  }

  close(): void {
    if (this.#state === "closed") return;
    this.#state = "closed";
    if (this.#confirm) clearTimeout(this.#confirm);
    this.#gone.abort();
    this.#served?.closed();
    this.#drop();
  }

  get open(): boolean {
    return this.#state === "open";
  }
}

function parseHello(b: Bytes): { name: string } {
  let v: unknown;
  try {
    v = JSON.parse(new TextDecoder().decode(b));
  } catch {
    v = null;
  }
  const name = (v as { name?: unknown } | null)?.name;
  return { name: typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : "Unknown browser" };
}

/** The session as the core sees it. Its writer (kernel/writer.ts) merges output COALESCE_MS and drops it past MAX_PENDING. */
class RemoteConnection implements Connection {
  readonly access: RemoteScope;
  readonly deviceId: string;
  #t: Transport;
  #send: (b: Bytes) => void;
  #close: () => void;
  #out: Promise<void> = Promise.resolve();
  #writer: ConnectionWriter;

  constructor(t: Transport, access: RemoteScope, deviceId: string, send: (b: Bytes) => void, close: () => void) {
    this.#t = t;
    this.access = access;
    this.deviceId = deviceId;
    this.#send = send;
    this.#close = close;
    // The relay link has no backpressure of its own yet (AR1-12-07): never "backed up", nothing buffered.
    this.#writer = new ConnectionWriter({ write: (line) => (this.#seal(line), true), buffered: () => 0, close: () => this.close() }, { coalesceMs: COALESCE_MS });
  }

  send(line: string): void {
    this.#writer.send(line);
  }

  event(e: CoreEvent, line: string): void {
    this.#writer.event(e, line);
  }

  #seal(line: string): void {
    const t = this.#t;
    this.#out = this.#out
      .then(async () => {
        for (const f of await sealLine(t, line.replace(/\n$/, ""))) this.#send(f);
      })
      .catch(() => this.#close());
  }

  close(): void {
    this.#writer.dispose();
    this.#close();
  }
}
