// Symmetric encryption (AES-256-GCM) for secrets and documents at rest, plus keyed hashing helpers.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

function secretFromEnv(name: string, minLen: number, devFallback: string): string {
  const v = process.env[name];
  if (v && v.length >= minLen) return v;
  if (process.env.NODE_ENV === "production") throw new Error(`${name} must be set (>= ${minLen} chars) in production`);
  return devFallback;
}

/** 32-byte key derived from ENCRYPTION_KEY (any string >= 32 chars). */
function encKey(): Buffer {
  return createHash("sha256").update(secretFromEnv("ENCRYPTION_KEY", 32, "dev-only-encryption-key-0123456789abcdef")).digest();
}

export function otpPepper(): string {
  return secretFromEnv("OTP_PEPPER", 32, "dev-only-otp-pepper-0123456789abcdef0123");
}

/** Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encryptString(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptString(blob: string): string {
  const [v, iv, tag, ct] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unsupported ciphertext");
  const d = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

export function encryptBuffer(data: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), ct]);
}

export function decryptBuffer(blob: Buffer): Buffer {
  if (blob[0] !== 1) throw new Error("Unsupported ciphertext");
  const iv = blob.subarray(1, 13);
  const tag = blob.subarray(13, 29);
  const d = createDecipheriv("aes-256-gcm", encKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(blob.subarray(29)), d.final()]);
}

export function hmacHex(key: string, message: string): string {
  return createHmac("sha256", key).update(message).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
