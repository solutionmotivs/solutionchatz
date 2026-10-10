// POST /api/auth/login/totp — second factor after password or email-code sign-in (authenticator code or one-time recovery code).
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { verifyMfaToken } from "@/lib/jwt";
import { decryptString } from "@/lib/security/crypto";
import { verifyTotp } from "@/lib/security/totp";
import { hit, peek, reset } from "@/lib/security/ratelimit-db";
import { startSession, clientIp } from "@/lib/session";
import { hashRecoveryCode, publicUser } from "@/lib/auth-flows";

const Schema = z.object({ mfa_token: z.string().min(10), code: z.string().optional(), recovery_code: z.string().optional() })
  .refine(v => v.code || v.recovery_code, { message: "Enter your authenticator code or a recovery code" });

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Invalid JSON", 400); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.errors[0].message, 400);
  const tok = await verifyMfaToken(parsed.data.mfa_token);
  if (!tok) return apiError("MFA_EXPIRED", "Your sign-in expired. Please start again.", 401);
  const user = await db.user.findUnique({ where: { id: tok.sub }, include: { organization: { select: { name: true, slug: true, kybStatus: true } } } });
  if (!user || user.status !== "ACTIVE" || !user.mfaEnabled || !user.mfaSecret || !user.emailVerifiedAt) return apiError("MFA_EXPIRED", "Your sign-in expired. Please start again.", 401);

  const failKey = `totp:fail:${user.id}`;
  const state = await peek(failKey);
  if (state && state.count >= 5) return apiError("RATE_LIMITED", "Too many wrong codes. Try again in 15 minutes.", 429);

  let ok = false;
  if (parsed.data.code) {
    const step = verifyTotp(decryptString(user.mfaSecret), parsed.data.code.trim(), Date.now(), user.mfaLastStep);
    if (step !== null) {
      // Atomic replay guard: only one request can consume a time-step.
      const upd = await db.user.updateMany({ where: { id: user.id, mfaLastStep: { lt: step } }, data: { mfaLastStep: step } });
      ok = upd.count === 1;
    }
  } else if (parsed.data.recovery_code) {
    const h = hashRecoveryCode(parsed.data.recovery_code);
    if (user.mfaRecoveryHashes.includes(h)) {
      await db.user.update({ where: { id: user.id }, data: { mfaRecoveryHashes: user.mfaRecoveryHashes.filter(x => x !== h) } });
      ok = true;
    }
  }
  if (!ok) {
    await hit(failKey, 5, 900);
    return apiError("INVALID_CODE", "Invalid code", 401);
  }
  await reset(failKey);
  await startSession(user, req, { method: tok.method, mfa: true });
  await db.auditLog.create({ data: { action: "login.success", resourceType: "User", resourceId: user.id, organizationId: user.organizationId, userId: user.id, ipAddress: clientIp(req), metadata: { mfa: true, recovery: !!parsed.data.recovery_code } } });
  return apiSuccess({
    status: "ok",
    recovery_codes_left: parsed.data.recovery_code ? user.mfaRecoveryHashes.length - 1 : undefined,
    user: { ...publicUser(user), organization: { id: user.organizationId, name: user.organization.name, slug: user.organization.slug, kyb_status: user.organization.kybStatus } },
  });
}
