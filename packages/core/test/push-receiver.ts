// The browser's side of Web Push in tests: decrypts an aes128gcm push body
// with the subscription's private key and auth secret (RFC 8291, RFC 8188).
import crypto from "node:crypto";

export function decryptPush(body: Uint8Array, uaPrivate: string, auth: string): string {
  const b = Buffer.from(body);
  const salt = b.subarray(0, 16);
  const idLen = b.readUInt8(20);
  const asPublic = b.subarray(21, 21 + idLen);
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(uaPrivate, "base64url"));
  const shared = ecdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", shared, Buffer.from(auth, "base64url"), keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const data = b.subarray(21 + idLen);
  const decipher = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
  // Strip the padding: zeros, then the delimiter (0x02 for the last record).
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  if (plain[end] !== 2) throw new Error("not a last record");
  return plain.subarray(0, end).toString("utf8");
}

/** A browser's push subscription keys, for a test device. */
export function receiverKeys(): { private: string; p256dh: string; auth: string } {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { private: ecdh.getPrivateKey().toString("base64url"), p256dh: ecdh.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") };
}
