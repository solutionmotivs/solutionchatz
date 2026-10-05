// One-time codes sent by email. Stored only as keyed hashes; short expiry; limited attempts; rate limited sends.
import { randomInt } from "crypto";
import { db } from "@/lib/db";
import { hmacHex, otpPepper, safeEqualHex } from "@/lib/security/crypto";
import { hit } from "@/lib/security/ratelimit-db";

export type OtpPurpose = "SIGNUP_VERIFY" | "LOGIN" | "PASSWORD_RESET" | "EMAIL_CHANGE" | "INVITE_ACCEPT";

export const OTP_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const SENDS_PER_HOUR_PER_EMAIL = 5;
const SENDS_PER_HOUR_PER_IP = 30;

export class OtpError extends Error {
  constructor(public code: "RATE_LIMITED" | "INVALID_CODE" | "EXPIRED" | "TOO_MANY_ATTEMPTS", message: string, public retryAfterSec?: number) {
    super(message);
  }
}

const norm = (email: string) => email.trim().toLowerCase();
const hashCode = (purpose: string, email: string, code: string) => hmacHex(otpPepper(), `${purpose}:${norm(email)}:${code}`);

export async function createOtp(opts: { purpose: OtpPurpose; email: string; userId?: string; ip?: string; payload?: Record<string, unknown> }) {
  const email = norm(opts.email);
  const byEmail = await hit(`otp:send:email:${opts.purpose}:${email}`, SENDS_PER_HOUR_PER_EMAIL, 3600);
  if (!byEmail.allowed) throw new OtpError("RATE_LIMITED", "Too many codes requested. Please try again later.", byEmail.retryAfterSec);
  if (opts.ip) {
    const byIp = await hit(`otp:send:ip:${opts.ip}`, SENDS_PER_HOUR_PER_IP, 3600);
    if (!byIp.allowed) throw new OtpError("RATE_LIMITED", "Too many requests from this network. Please try again later.", byIp.retryAfterSec);
  }
  // A new code invalidates earlier unused codes for the same purpose.
  await db.otpChallenge.updateMany({ where: { email, purpose: opts.purpose, consumedAt: null }, data: { consumedAt: new Date() } });
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const ch = await db.otpChallenge.create({
    data: {
      purpose: opts.purpose, email, userId: opts.userId ?? null, codeHash: hashCode(opts.purpose, email, code),
      expiresAt: new Date(Date.now() + OTP_TTL_MIN * 60_000), maxAttempts: MAX_ATTEMPTS, ip: opts.ip ?? null,
      payload: (opts.payload ?? undefined) as never,
    },
  });
  return { id: ch.id, code };
}

/** Verifies and consumes the latest code. Throws OtpError on failure. */
export async function verifyOtp(opts: { purpose: OtpPurpose; email: string; code: string; ip?: string }) {
  const email = norm(opts.email);
  if (opts.ip) {
    const g = await hit(`otp:verify:ip:${opts.ip}`, 60, 900);
    if (!g.allowed) throw new OtpError("RATE_LIMITED", "Too many attempts. Please try again later.", g.retryAfterSec);
  }
  const ch = await db.otpChallenge.findFirst({ where: { email, purpose: opts.purpose, consumedAt: null }, orderBy: { createdAt: "desc" } });
  if (!ch) throw new OtpError("INVALID_CODE", "Invalid or expired code");
  if (ch.expiresAt.getTime() < Date.now()) throw new OtpError("EXPIRED", "That code has expired. Request a new one.");
  if (ch.attempts >= ch.maxAttempts) throw new OtpError("TOO_MANY_ATTEMPTS", "Too many wrong attempts. Request a new code.");
  const ok = /^\d{6}$/.test(opts.code) && safeEqualHex(ch.codeHash, hashCode(opts.purpose, email, opts.code));
  if (!ok) {
    await db.otpChallenge.update({ where: { id: ch.id }, data: { attempts: { increment: 1 } } });
    throw new OtpError("INVALID_CODE", "Invalid or expired code");
  }
  // Atomic consume: only one request can win.
  const claimed = await db.otpChallenge.updateMany({ where: { id: ch.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (claimed.count !== 1) throw new OtpError("INVALID_CODE", "Invalid or expired code");
  return ch;
}

/** Test/dev only: lets automated tests read the code from the API response. Never active in production. */
export function exposeDevOtp(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.AUTH_EXPOSE_DEV_OTP === "true";
}
