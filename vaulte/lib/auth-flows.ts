// Shared building blocks for the sign-up / sign-in routes.
import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";
import { createOtp, exposeDevOtp, OTP_TTL_MIN, type OtpPurpose } from "@/lib/otp";
import { sendEmail } from "@/lib/email/sender";
import { otpEmail } from "@/lib/email/templates";
import { signMfaToken } from "@/lib/jwt";
import { startSession, clientIp } from "@/lib/session";
import type { User } from "@prisma/client";

export const LOCK_AFTER_FAILURES = 5;
export const LOCK_MINUTES = 15;

export function publicUser(u: Pick<User, "id" | "name" | "email" | "role" | "isStaff" | "mfaEnabled" | "organizationId">) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, is_staff: u.isStaff, mfa_enabled: u.mfaEnabled, organization_id: u.organizationId };
}

/** Creates and emails a code. Returns whether the email was handed to the provider (and the code in dev/test only). */
export async function sendOtp(req: Request, opts: { purpose: OtpPurpose; email: string; name?: string; userId?: string; payload?: Record<string, unknown> }) {
  const { code } = await createOtp({ purpose: opts.purpose, email: opts.email, userId: opts.userId, ip: clientIp(req), payload: opts.payload });
  const res = await sendEmail({ to: opts.email, template: otpEmail({ name: opts.name, code, purpose: opts.purpose, minutes: OTP_TTL_MIN }) });
  return { sent: res.success, devCode: exposeDevOtp() ? code : undefined };
}

/** After primary authentication: either ask for the second factor or open the session. */
export async function completeLogin(req: Request, user: User, method: "PASSWORD" | "EMAIL_OTP") {
  if (user.mfaEnabled && user.mfaSecret) {
    return { kind: "mfa" as const, mfaToken: await signMfaToken({ sub: user.id, method }) };
  }
  const session = await startSession(user, req, { method, mfa: false });
  return { kind: "session" as const, session };
}

export function newRecoveryCodes(n = 10): { plain: string[]; hashes: string[] } {
  const plain = Array.from({ length: n }, () => {
    const b = randomBytes(5).toString("hex");
    return `${b.slice(0, 5)}-${b.slice(5)}`;
  });
  return { plain, hashes: plain.map(hashRecoveryCode) };
}

export const hashRecoveryCode = (c: string) => createHash("sha256").update(c.trim().toLowerCase()).digest("hex");

export async function createDefaultApiKey(organizationId: string): Promise<string> {
  const bcrypt = await import("bcryptjs");
  const raw = `vlt_test_${randomBytes(24).toString("hex")}`;
  await db.apiKey.create({
    data: {
      name: "Default test key", keyHash: await bcrypt.hash(raw, 10), keyPrefix: raw.slice(0, 16), isLive: false,
      scopes: ["payments:read", "payments:write", "invoices:read", "invoices:write", "kyb:write", "fx:read", "webhooks:write", "entities:read"],
      organizationId,
    },
  });
  return raw;
}
export const TERMS_VERSION = "2026-10-08";
