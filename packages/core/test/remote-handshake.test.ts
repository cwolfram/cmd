// The host's side of a device's handshake (remote/session.ts, limiter.ts): a session
// opens only on the device's first message, so a replayed message 1 opens nothing;
// failures are counted per source, so junk from one address doesn't lock out the
// others; and junk can't burn the pairing code.

import { describe, expect, it, vi } from "vitest";
import type { RemoteScope } from "@cmd/protocol";
import { frame, generateKeyPair, openDeviceSession, randomBytes, Wire, type Bytes, type KeyPair } from "@cmd/remote-crypto";
import { HostChannel, type ChannelHost } from "../src/remote/session.ts";
import { ALL_SOURCES, FailureLimiter, PER_SOURCE } from "../src/remote/limiter.ts";

/** A fake host side: one known device, an optional pairing, and a log of what happened. */
function host(key: KeyPair, device: KeyPair | null, pairing: { psk: Bytes; scope: RemoteScope } | null = null) {
  const log: string[] = [];
  let current = pairing;
  const h: ChannelHost = {
    key,
    version: "1",
    device: (pub) => (device && pub.every((b, i) => b === device.publicKey[i]) ? { id: "d1", scope: "view" } : null),
    seen: (id) => void log.push(`seen ${id}`),
    pairing: () => current,
    usePairing: (p) => (current === p ? ((current = null), true) : false),
    approve: async () => "view",
    addDevice: () => (log.push("paired"), { id: "d2" }),
    failed: (reason, ip) => void log.push(`failed ${ip}: ${reason}`),
    serve: () => (log.push("serve"), { receive: () => {}, closed: () => {} }),
    opened: () => void log.push("opened"),
  };
  return { h, log, pairing: () => current };
}

/** A device talking to `channel`; what it sends goes straight in. */
function device(channel: () => HostChannel, o: { hostKey: Bytes; device: KeyPair; psk?: Bytes }) {
  const sent: Bytes[] = [];
  const d = openDeviceSession({ ...o, hello: { name: "Phone" }, socket: { send: (b) => (sent.push(b), channel().receive(b)), close: () => {} } });
  return { d, sent };
}

const channel = (h: ChannelHost, ip = "1.2.3.4") => {
  const out: Bytes[] = [];
  let dropped = false;
  const c = new HostChannel({ channel: 1, ip, host: h, send: (b) => out.push(b), drop: () => (dropped = true), confirmMs: 50 });
  return { c, out, dropped: () => dropped };
};

describe("a device's handshake", () => {
  it("opens the session on the device's first message, and a replayed message 1 opens nothing", async () => {
    const key = await generateKeyPair();
    const dev = await generateKeyPair();
    const real = host(key, dev);
    const a = channel(real.h);
    const { d, sent } = device(() => a.c, { hostKey: key.publicKey, device: dev });
    for (let i = 0; !a.out.length && i < 100; i++) await new Promise((r) => setTimeout(r, 5));
    d.receive(a.out[0]!);
    await d.session;
    await vi.waitFor(() => expect(real.log).toEqual(["seen d1", "serve", "opened"]));

    // Someone who recorded message 1 sends it again on a new channel.
    const replay = host(key, dev);
    const b = channel(replay.h, "6.6.6.6");
    b.c.receive(sent[0]!);
    await vi.waitFor(() => expect(b.out).toHaveLength(1)); // the host's reply, which the replayer can't read
    expect(b.c.open).toBe(false);
    await vi.waitFor(() => expect(b.dropped()).toBe(true));
    expect(replay.log).toEqual(["failed 6.6.6.6: no message after the handshake (a replay?)"]);
  });

  it("keeps the pairing code through a junk pair frame, then pairs with the right one", async () => {
    const key = await generateKeyPair();
    const psk = randomBytes(32);
    const fake = host(key, null, { psk, scope: "view" });
    const junk = channel(fake.h, "6.6.6.6");
    junk.c.receive(frame(Wire.pair, randomBytes(96)));
    await vi.waitFor(() => expect(junk.dropped()).toBe(true));
    expect(fake.pairing()).not.toBeNull();
    const ok = channel(fake.h);
    const { d } = device(() => ok.c, { hostKey: key.publicKey, device: await generateKeyPair(), psk });
    for (let i = 0; !ok.out.length && i < 100; i++) await new Promise((r) => setTimeout(r, 5));
    d.receive(ok.out[0]!);
    await d.session;
    await vi.waitFor(() => expect(fake.log).toContain("opened"));
    expect(fake.log).toContain("paired");
    expect(fake.pairing()).toBeNull();
  });
});

describe("the failure limiter", () => {
  it("blocks the source that failed, not the others", () => {
    const l = new FailureLimiter();
    for (let i = 0; i < PER_SOURCE; i++) l.failed("A");
    expect(l.blocked("A")).toBe(true);
    expect(l.blocked("B")).toBe(false);
  });

  it("has a ceiling over all sources", () => {
    const l = new FailureLimiter();
    for (let i = 0; i < ALL_SOURCES; i++) l.failed(`ip${i}`);
    expect(l.blocked("someone-new")).toBe(true);
  });

  it("forgets after a minute and keeps at most a thousand sources", () => {
    let now = 0;
    const l = new FailureLimiter(() => now);
    for (let i = 0; i < 5000; i++) l.failed(`ip${i}`);
    expect(l.sources).toBe(1000);
    now = 61_000;
    expect(l.sources).toBe(0);
    expect(l.blocked("ip4999")).toBe(false);
  });
});
