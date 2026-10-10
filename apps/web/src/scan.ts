// Reading the Mac's pairing code inside the app: recognising a pairing link in
// whatever was scanned or pasted, and a QR decoder for camera frames. The
// browser's BarcodeDetector where it reads QR codes (Android Chrome), else jsQR
// on downscaled canvas frames, loaded only when scanning starts (the page's CSP
// allows no workers from blobs, so it runs on the main thread).

import { decodePairing } from "@cmd/remote-crypto";

/**
 * The pairing fragment in a scanned or pasted string, or null when it isn't a
 * cmd pairing link: a URL whose path ends in /pair (any client origin; the
 * fragment says where the Mac is), or the fragment alone.
 */
export function pairingFragment(text: string): string | null {
  const t = text.trim();
  let hash = t;
  if (!/^#?v1\./.test(t)) {
    let url: URL;
    try {
      url = new URL(t);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(url.protocol) || !/\/pair\/?$/.test(url.pathname)) return null;
    hash = url.hash;
  }
  try {
    decodePairing(hash);
  } catch {
    return null;
  }
  return hash.startsWith("#") ? hash : `#${hash}`;
}

/**
 * The client a pairing link was made for, when that isn't this page: in direct
 * modes each Mac serves its own client and takes sockets only from its pages,
 * so the link has to be opened there. Null for a bare fragment or this origin.
 */
export function elsewhere(text: string, here: string): string | null {
  try {
    const url = new URL(text.trim());
    return url.origin === here ? null : url.origin;
  } catch {
    return null;
  }
}

/** Reads the QR code in a video frame, if any. */
export type Decode = (video: HTMLVideoElement) => Promise<string | null>;

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
interface DetectorClass {
  new (o: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}

/** Frames are scaled down to this many pixels on their long side for jsQR. */
const MAX_SIDE = 720;

export async function qrDecoder(): Promise<Decode> {
  const BD = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (BD && (await BD.getSupportedFormats().catch((): string[] => [])).includes("qr_code")) {
    const d = new BD({ formats: ["qr_code"] });
    return async (video) => (await d.detect(video).catch(() => []))[0]?.rawValue ?? null;
  }
  // CommonJS with __esModule: depending on the interop (Vite dev or build) `default` is the function or the exports holding it.
  const m: { default: unknown } = await import("jsqr");
  const jsQR = (typeof m.default === "function" ? m.default : (m.default as { default: unknown }).default) as typeof import("jsqr").default;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!ctx || !w || !h) return null;
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    canvas.width = Math.round(w * k);
    canvas.height = Math.round(h * k);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // Both ways: the Mac draws its code dark on light, a screenshot of a dark theme may not.
    return jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" })?.data ?? null;
  };
}
