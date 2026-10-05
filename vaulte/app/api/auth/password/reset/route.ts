// POST /api/auth/password/reset — set a new password with the emailed code. Signs out every session.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { verifyOtp, OtpError } from "@/lib/otp";
import { hashPassword, validatePassword } from "@/lib/security/password";
import { clientIp, revokeAllSessions } from "@/lib/session";
import { sendEmail } from "@/lib/email/sender";
import { securityNoticeEmail } from "@/lib/email/templates";

const Schema = z.object({ email: z.string().trim().email(), code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"), new_password: z.string().min(10).max(128) });

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Invalid JSON", 400); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.errors[0].message, 400, parsed.error.errors[0].path.join("."));
  const email = parsed.data.email.toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  const pwErr = validatePassword(parsed.data.new_password, { email, name: user?.name });
  if (pwErr) return apiError("WEAK_PASSWORD", pwErr, 400, "new_password");
  try {
    await verifyOtp({ purpose: "PASSWORD_RESET", email, code: parsed.data.code, ip: clientIp(req) });
  } catch (e) {
    if (e instanceof OtpError) return apiError(e.code, e.message, e.code === "RATE_LIMITED" ? 429 : 400);
    throw e;
  }
  if (!user || user.status !== "ACTIVE") return apiError("INVALID_CODE", "Invalid or expired code", 400);
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.new_password), passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null, emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
  });
  await revokeAllSessions(user.id);
  await db.auditLog.create({ data: { action: "password.reset", resourceType: "User", resourceId: user.id, organizationId: user.organizationId, userId: user.id, ipAddress: clientIp(req) } });
  sendEmail({ to: email, template: securityNoticeEmail({ name: user.name, event: "Your password was reset", detail: "All devices were signed out." }) }).catch(() => {});
  return apiSuccess({ status: "ok", message: "Password updated. Please sign in." });
}
