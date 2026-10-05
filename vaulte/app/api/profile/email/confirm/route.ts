import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { requireUser } from "@/lib/auth-guards";
import { OtpError, verifyOtp } from "@/lib/otp";
import { clientIp, revokeAllSessions } from "@/lib/session";
import { sendEmail } from "@/lib/email/sender";
import { securityNoticeEmail } from "@/lib/email/templates";

const Schema = z.object({ new_email: z.string().trim().email(), code: z.string().regex(/^\d{6}$/) });

export async function POST(req: NextRequest) {
  const g = await requireUser(req);
  if (g.response) return g.response;
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Invalid JSON", 400); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Enter the new email and 6-digit code", 400);
  const newEmail = parsed.data.new_email.toLowerCase();
  let ch;
  try {
    ch = await verifyOtp({ purpose: "EMAIL_CHANGE", email: newEmail, code: parsed.data.code, ip: clientIp(req) });
  } catch (e) {
    if (e instanceof OtpError) return apiError(e.code, e.message, e.code === "RATE_LIMITED" ? 429 : 400);
    throw e;
  }
  if ((ch.payload as { userId?: string } | null)?.userId !== g.user.id) return apiError("INVALID_CODE", "Invalid or expired code", 400);
  const old = await db.user.findUniqueOrThrow({ where: { id: g.user.id } });
  try {
    await db.user.update({ where: { id: old.id }, data: { email: newEmail, emailVerifiedAt: new Date() } });
  } catch {
    return apiError("EMAIL_TAKEN", "That email can no longer be used", 409);
  }
  await revokeAllSessions(old.id, g.user.sessionId);
  await db.auditLog.create({ data: { action: "email.changed", resourceType: "User", resourceId: old.id, organizationId: old.organizationId, userId: old.id } });
  sendEmail({ to: old.email, template: securityNoticeEmail({ name: old.name, event: "Your sign-in email was changed", detail: `New address: ${newEmail}` }) }).catch(() => {});
  return apiSuccess({ status: "ok", email: newEmail });
}
