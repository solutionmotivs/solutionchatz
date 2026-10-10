import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hotp, totpAt, verifyTotp, generateTotpSecret } from "@/lib/security/totp";
import { decryptBuffer, decryptString, encryptBuffer, encryptString, hmacHex } from "@/lib/security/crypto";
import { validatePassword } from "@/lib/security/password";
import { isPrivateIp, validateWebhookUrlShape } from "@/lib/security/ssrf";

describe("TOTP (RFC 6238 / RFC 4226 vectors)", () => {
  const secret = Buffer.from("12345678901234567890");
  it("matches RFC 4226 HOTP vectors", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((e, i) => expect(hotp(secret, i)).toBe(e));
  });
  it("matches RFC 6238 SHA-1 vector at T=59", () => {
    expect(totpAt(base32Encode(secret), 59, 8)).toBe("94287082");
  });
  it("base32 round-trips", () => {
    const s = generateTotpSecret();
    expect(base32Encode(base32Decode(s))).toBe(s);
  });
  it("accepts +/-1 step, rejects replay and bad codes", () => {
    const s = base32Encode(secret);
    const now = 1_700_000_000_000;
    const code = totpAt(s, now / 1000);
    const step = verifyTotp(s, code, now, 0);
    expect(step).toBe(Math.floor(now / 30000));
    expect(verifyTotp(s, code, now, step!)).toBeNull(); // replay
    expect(verifyTotp(s, totpAt(s, now / 1000 - 30), now, 0)).not.toBeNull(); // previous window
    expect(verifyTotp(s, totpAt(s, now / 1000 + 120), now, 0)).toBeNull(); // too far
    expect(verifyTotp(s, "12345", now, 0)).toBeNull();
  });
});

describe("encryption", () => {
  it("round-trips strings and buffers and detects tampering", () => {
    expect(decryptString(encryptString("secret-value"))).toBe("secret-value");
    const buf = Buffer.from("document bytes \u0000\u0001");
    expect(decryptBuffer(encryptBuffer(buf)).equals(buf)).toBe(true);
    const blob = encryptBuffer(buf);
    blob[blob.length - 1] ^= 1;
    expect(() => decryptBuffer(blob)).toThrow();
    const s = encryptString("x").split(".");
    s[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptString(s.join("."))).toThrow();
  });
  it("hmac differs by key and message", () => {
    expect(hmacHex("a", "m")).not.toBe(hmacHex("b", "m"));
    expect(hmacHex("a", "m")).not.toBe(hmacHex("a", "n"));
  });
});

describe("password policy", () => {
  it("rejects short, common and personal passwords", () => {
    expect(validatePassword("short")).toMatch(/at least 10/);
    expect(validatePassword("password123")).toMatch(/at least 10|common/);
    expect(validatePassword("Tr0ub4dor-&3xyz")).toBeNull();
    expect(validatePassword("rahul-sharma-2026!", { name: "Rahul Sharma" })).toMatch(/name/);
    expect(validatePassword("rahul.sharma99-secure", { email: "rahul.sharma99@x.com" })).toMatch(/email/);
    expect(validatePassword("aaaaaaaaaaaa")).toMatch(/repeated/);
  });
  it("accepts a long passphrase", () => {
    expect(validatePassword("correct horse battery staple")).toBeNull();
  });
});

describe("ssrf guard", () => {
  it("flags private and reserved addresses", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "192.168.1.1", "172.16.5.5", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
    expect(isPrivateIp("8.8.8.8")).toBe(false);
  });
  it("requires https and rejects credentials in URLs", () => {
    expect(validateWebhookUrlShape("https://example.com/hook").ok).toBe(true);
    expect(validateWebhookUrlShape("https://user:pw@example.com/").ok).toBe(false);
    expect(validateWebhookUrlShape("not a url").ok).toBe(false);
  });
});
