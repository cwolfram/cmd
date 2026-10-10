// Web Push from the core (remote/webpush.ts): the payload encryption against
// RFC 8291's own example, the VAPID token a push service checks, and which
// endpoints a device may name.
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { encryptPayload, generateVapidKeys, sendPush, SubscriptionGone, validEndpoint, vapidAuthorization, vapidPublicKey } from "../src/remote/webpush.ts";
import { decryptPush } from "./push-receiver.ts";

// RFC 8291 §5 and Appendix A.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  message:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
    "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
    "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

const sub = { endpoint: "https://web.push.apple.com/abc", keys: { p256dh: RFC.uaPublic, auth: RFC.auth } };

describe("web push", () => {
  it("encrypts exactly as RFC 8291's example", () => {
    const ephemeral = crypto.createECDH("prime256v1");
    ephemeral.setPrivateKey(Buffer.from(RFC.asPrivate, "base64url"));
    const out = encryptPayload(new TextEncoder().encode(RFC.plaintext), sub, { salt: Buffer.from(RFC.salt, "base64url"), ephemeral });
    expect(Buffer.from(out).toString("base64url")).toBe(RFC.message);
  });

  it("encrypts so only the subscription's browser reads it", () => {
    const out = encryptPayload(new TextEncoder().encode("hello"), sub);
    expect(decryptPush(out, RFC.uaPrivate, RFC.auth)).toBe("hello");
    // Fresh salt and key every time.
    expect(Buffer.from(encryptPayload(new TextEncoder().encode("hello"), sub)).equals(Buffer.from(out))).toBe(false);
  });

  it("signs a VAPID token the push service can check", () => {
    const keys = generateVapidKeys();
    const now = Date.now();
    const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/xyz", keys, "https://example.org", now);
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    const [token, k] = [m[1]!, m[2]!];
    expect(k).toBe(vapidPublicKey(keys));
    const [h, c, sig] = token.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claims).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "https://example.org" });
    expect(claims.exp).toBeGreaterThan(now / 1000);
    expect(claims.exp).toBeLessThanOrEqual(now / 1000 + 24 * 3600);
    // Verified with the key the browser was given (applicationServerKey), as the push service does.
    const raw = Buffer.from(k, "base64url");
    const jwk = { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") };
    const pub = crypto.createPublicKey({ key: jwk, format: "jwk" });
    expect(crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))).toBe(true);
  });

  it("posts the encrypted payload, and says when the subscription is gone", async () => {
    const keys = generateVapidKeys();
    const seen: { url: string; init: RequestInit }[] = [];
    let status = 201;
    const fake = (async (url: string, init: RequestInit) => (seen.push({ url, init }), new Response(null, { status }))) as typeof fetch;
    await sendPush(sub, new TextEncoder().encode("hi"), { keys, subject: "https://example.org", ttl: 60, urgency: "high", fetch: fake });
    expect(seen[0]!.url).toBe(sub.endpoint);
    expect(seen[0]!.init.headers).toMatchObject({ "Content-Encoding": "aes128gcm", TTL: "60", Urgency: "high" });
    expect(decryptPush(seen[0]!.init.body as Uint8Array, RFC.uaPrivate, RFC.auth)).toBe("hi");
    status = 410;
    await expect(sendPush(sub, new TextEncoder().encode("hi"), { keys, subject: "https://example.org", ttl: 60, urgency: "high", fetch: fake })).rejects.toThrow(SubscriptionGone);
    status = 500;
    await expect(sendPush(sub, new TextEncoder().encode("hi"), { keys, subject: "https://example.org", ttl: 60, urgency: "high", fetch: fake })).rejects.not.toThrow(SubscriptionGone);
  });

  it("refuses a payload that doesn't fit one record", () => {
    expect(() => encryptPayload(new Uint8Array(5000), sub)).toThrow(/too big/);
  });

  it("only posts to the browsers' push services", () => {
    expect(validEndpoint("https://web.push.apple.com/QGxl")).toBe(true);
    expect(validEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(validEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(validEndpoint("https://wns2-db5p.notify.windows.com/w/?token=abc")).toBe(true);
    expect(validEndpoint("http://web.push.apple.com/x")).toBe(false);
    expect(validEndpoint("https://web.push.apple.com:8443/x")).toBe(false);
    expect(validEndpoint("https://user:pw@fcm.googleapis.com/x")).toBe(false);
    expect(validEndpoint("https://192.168.1.1/x")).toBe(false);
    expect(validEndpoint("https://localhost/x")).toBe(false);
    expect(validEndpoint("https://push.apple.com.evil.test/x")).toBe(false);
    expect(validEndpoint("not a url")).toBe(false);
  });
});
