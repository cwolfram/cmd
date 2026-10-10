// Pairing in the web client without a browser: recognising a pairing link in a
// scanned or pasted string, the iOS gate (pair here, or ask to pair from the
// Home Screen app), one pairing per Mac (moving the legacy record, listing),
// and the Mac's QR code read back by jsQR as the camera path does.
import { describe, expect, it } from "vitest";
import { encode } from "uqr";
import jsQRModule from "jsqr";
import { encodePairing, toBase64Url } from "@cmd/remote-crypto";
import { macsOf, migration, type Stored } from "../src/identity.ts";
import { installHint } from "../src/install.ts";
import { elsewhere, pairingFragment } from "../src/scan.ts";

const jsQR = jsQRModule.default;

const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);
const fragment = encodePairing({ socket: "wss://relay.example.com", route: toBase64Url(bytes(16, 1)), hostKey: bytes(32, 2), psk: bytes(32, 3) });
const url = `https://cmd.endtime-instruments.org/pair#${fragment}`;

describe("pairingFragment", () => {
  it("finds the fragment in a pairing URL, from any client origin", () => {
    expect(pairingFragment(url)).toBe(`#${fragment}`);
    expect(pairingFragment(`  ${url}\n`)).toBe(`#${fragment}`);
    expect(pairingFragment(`http://127.0.0.1:5180/pair#${fragment}`)).toBe(`#${fragment}`);
  });

  it("takes the fragment alone, with or without #", () => {
    expect(pairingFragment(fragment)).toBe(`#${fragment}`);
    expect(pairingFragment(`#${fragment}`)).toBe(`#${fragment}`);
  });

  it("refuses anything else", () => {
    expect(pairingFragment("https://example.com/menu")).toBeNull();
    expect(pairingFragment(`https://example.com/other#${fragment}`)).toBeNull();
    expect(pairingFragment("https://cmd.endtime-instruments.org/pair")).toBeNull();
    expect(pairingFragment("https://cmd.endtime-instruments.org/pair#v1.bad")).toBeNull();
    expect(pairingFragment(`javascript:alert(1)//pair#${fragment}`)).toBeNull();
    expect(pairingFragment("hello")).toBeNull();
    expect(pairingFragment("")).toBeNull();
  });
});

describe("elsewhere", () => {
  it("names the client a link was made for when it isn't this page", () => {
    expect(elsewhere(`http://127.0.0.1:47392/pair#${fragment}`, "http://127.0.0.1:47391")).toBe("http://127.0.0.1:47392");
    expect(elsewhere(url, "https://cmd.endtime-instruments.org")).toBeNull();
    expect(elsewhere(fragment, "https://cmd.endtime-instruments.org")).toBeNull();
  });
});

describe("installHint", () => {
  const iPhone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const iPadDesktop = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
  const at = (ua: string, o: Partial<{ touchPoints: number; standalone: boolean; canPrompt: boolean }> = {}) =>
    installHint({ ua, touchPoints: 5, standalone: false, canPrompt: false, ...o });

  it("gives iPhone and iPad the Home Screen steps", () => {
    expect(at(iPhone)).toBe("ios");
    expect(at(iPadDesktop)).toBe("ios");
  });

  it("offers the browser's install prompt where there is one", () => {
    expect(at(android, { canPrompt: true })).toBe("prompt");
    expect(at(android)).toBeNull();
    expect(at(iPadDesktop, { touchPoints: 0 })).toBeNull(); // a Mac
  });

  it("gives none inside an installed app", () => {
    expect(at(iPhone, { standalone: true })).toBeNull();
    expect(at(android, { standalone: true, canPrompt: true })).toBeNull();
  });
});

describe("one pairing per Mac", () => {
  const rec = (key: number, extra: Partial<Stored> = {}): Stored => ({ hostKey: bytes(32, key) as Uint8Array<ArrayBuffer>, route: "r", deviceId: "d", ...extra });
  const k = (n: number) => toBase64Url(bytes(32, n));

  it("moves the legacy record to its host key", () => {
    const legacy = rec(7);
    expect(migration([["mac", legacy]])).toEqual({ put: [[k(7), legacy]], drop: ["mac"] });
  });

  it("keeps a pairing already under that key, and drops the legacy one", () => {
    expect(migration([["mac", rec(7)], [k(7), rec(7, { name: "newer" })]])).toEqual({ put: [], drop: ["mac"] });
  });

  it("drops a legacy record the browser couldn't read back", () => {
    expect(migration([["mac", null]])).toEqual({ put: [], drop: ["mac"] });
  });

  it("does nothing without one", () => {
    expect(migration([[k(1), rec(1)]])).toEqual({ put: [], drop: [] });
  });

  it("lists the Macs used last first, skipping what isn't a pairing", () => {
    const macs = macsOf([
      [k(1), rec(1, { name: "Studio", lastUsed: 10 })],
      [k(2), rec(2, { name: "MacBook Pro", lastUsed: 30 })],
      [k(3), rec(3)],
      [k(4), null],
      ["mac", rec(5)],
    ]);
    expect(macs).toEqual([
      { key: k(2), name: "MacBook Pro", lastUsed: 30 },
      { key: k(1), name: "Studio", lastUsed: 10 },
      { key: k(3), name: "Mac", lastUsed: 0 },
    ]);
  });
});

describe("the Mac's QR code", () => {
  it("reads back as the pairing link", () => {
    // As Remote.tsx draws it (uqr, ECC L), at 4 px per module, dark on light.
    const qr = encode(url, { ecc: "L", border: 4 });
    const px = 4;
    const side = qr.size * px;
    const rgba = new Uint8ClampedArray(side * side * 4);
    for (let y = 0; y < side; y++)
      for (let x = 0; x < side; x++) {
        const v = qr.data[Math.floor(y / px)][Math.floor(x / px)] ? 0 : 255;
        rgba.set([v, v, v, 255], (y * side + x) * 4);
      }
    const read = jsQR(rgba, side, side, { inversionAttempts: "attemptBoth" });
    expect(read?.data).toBe(url);
    expect(pairingFragment(read!.data)).toBe(`#${fragment}`);
  });
});
