// POST /api/auth/2fa/enable — confirm enrolment with a code. Returns one-time recovery codes (shown once).
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { requireUser } from "@/lib/auth-guards";
import { decryptString } from "@/lib/security/crypto";
import { verifyTotp } from "@/lib/security/totp";
import { hit } from "@/lib/security/ratelimit-db";
import { newRecoveryCodes } from "@/lib/auth-flows";
import { revokeAllSessions } from "@/lib/session";
import { sendEmail } from "@/lib/email/sender";
import { securityNoticeEmail } from "@/lib/email/templates";

const Schema = z.object({ code: z.string().regex(/^\d{6}$/) });

export async function POST(req: NextRequest) {
  const g = await requireUser(req);
  if (g.response) return g.response;
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Invalid JSON", 400); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Enter the 6-digit code", 400);
  if (!(await hit(`2fa:enable:${g.user.id}`, 8, 900)).allowed) return apiError("RATE_LIMITED", "Too many attempts", 429);
  const user = await db.user.findUniqueOrThrow({ where: { id: g.user.id } });
  if (user.mfaEnabled) return apiError("ALREADY_ENABLED", "Two-factor authentication is already enabled", 409);
  if (!user.mfaSecret) return apiError("NOT_STARTED", "Start setup first", 409);
  const step = verifyTotp(decryptString(user.mfaSecret), parsed.data.code, Date.now(), 0);
  if (step === null) return apiError("INVALID_CODE", "That code is not valid. Check your authenticator app's clock.", 400);
  const codes = newRecoveryCodes();
  await db.user.update({ where: { id: user.id }, data: { mfaEnabled: true, mfaLastStep: step, mfaRecoveryHashes: codes.hashes } });
  await revokeAllSessions(user.id, g.user.sessionId);
  await db.auditLog.create({ data: { action: "2fa.enabled", resourceType: "User", resourceId: user.id, organizationId: user.organizationId, userId: user.id } });
  sendEmail({ to: user.email, template: securityNoticeEmail({ name: user.name, event: "Two-factor authentication was enabled" }) }).catch(() => {});
  return apiSuccess({ status: "enabled", recovery_codes: codes.plain, notice: "Save these recovery codes now. Each works once and they are not shown again." });
}
