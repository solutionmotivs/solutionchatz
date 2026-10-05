import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { requireUser } from "@/lib/auth-guards";
import { verifyPassword } from "@/lib/security/password";
import { decryptString } from "@/lib/security/crypto";
import { verifyTotp } from "@/lib/security/totp";
import { hit } from "@/lib/security/ratelimit-db";
import { sendEmail } from "@/lib/email/sender";
import { securityNoticeEmail } from "@/lib/email/templates";

const Schema = z.object({ password: z.string().min(1).max(128), code: z.string().regex(/^\d{6}$/) });

export async function POST(req: NextRequest) {
  const g = await requireUser(req);
  if (g.response) return g.response;
  if (g.user.isStaff) return apiError("FORBIDDEN", "Staff accounts must keep two-factor authentication enabled", 403);
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Invalid JSON", 400); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Password and 6-digit code required", 400);
  if (!(await hit(`2fa:disable:${g.user.id}`, 5, 900)).allowed) return apiError("RATE_LIMITED", "Too many attempts", 429);
  const user = await db.user.findUniqueOrThrow({ where: { id: g.user.id } });
  if (!user.mfaEnabled || !user.mfaSecret) return apiError("NOT_ENABLED", "Two-factor authentication is not enabled", 409);
  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) return apiError("INVALID_CREDENTIALS", "Password is incorrect", 401);
  const step = verifyTotp(decryptString(user.mfaSecret), parsed.data.code, Date.now(), user.mfaLastStep);
  if (step === null) return apiError("INVALID_CODE", "Invalid code", 400);
  await db.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryHashes: [], mfaLastStep: 0 } });
  await db.auditLog.create({ data: { action: "2fa.disabled", resourceType: "User", resourceId: user.id, organizationId: user.organizationId, userId: user.id } });
  sendEmail({ to: user.email, template: securityNoticeEmail({ name: user.name, event: "Two-factor authentication was turned off" }) }).catch(() => {});
  return apiSuccess({ status: "disabled" });
}
