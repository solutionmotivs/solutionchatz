// POST /api/auth/verify-email — proves ownership of the email, opens the first session, issues the first sandbox API key (shown once).
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { verifyOtp, OtpError } from "@/lib/otp";
import { clientIp, startSession } from "@/lib/session";
import { createDefaultApiKey, publicUser } from "@/lib/auth-flows";
import { sendEmail } from "@/lib/email/sender";
import { welcomeEmail } from "@/lib/email/templates";

const Schema = z.object({ email: z.string().trim().email(), code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") });

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Invalid JSON", 400); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.errors[0].message, 400);
  const email = parsed.data.email.toLowerCase();
  try {
    await verifyOtp({ purpose: "SIGNUP_VERIFY", email, code: parsed.data.code, ip: clientIp(req) });
  } catch (e) {
    if (e instanceof OtpError) return apiError(e.code, e.message, e.code === "RATE_LIMITED" ? 429 : 400);
    throw e;
  }
  const user = await db.user.findUnique({ where: { email }, include: { organization: true } });
  if (!user || user.status !== "ACTIVE") return apiError("INVALID_CODE", "Invalid or expired code", 400);

  const firstTime = !user.emailVerifiedAt;
  if (firstTime) await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  let rawKey: string | undefined;
  if (firstTime && user.role === "OWNER" && (await db.apiKey.count({ where: { organizationId: user.organizationId } })) === 0) {
    rawKey = await createDefaultApiKey(user.organizationId);
  }
  await startSession({ ...user, isStaff: user.isStaff }, req, { method: "SIGNUP", mfa: false });
  await db.auditLog.create({ data: { action: "email.verified", resourceType: "User", resourceId: user.id, organizationId: user.organizationId, userId: user.id } });
  if (firstTime) sendEmail({ to: email, template: welcomeEmail(user.name, user.organization.name), organizationId: user.organizationId }).catch(() => {});

  return apiSuccess({
    user: publicUser(user),
    organization: { id: user.organization.id, name: user.organization.name, account_type: user.organization.accountType, kyb_status: user.organization.kybStatus },
    ...(rawKey ? { test_api_key: rawKey, key_notice: "Store this key now. It is shown only once." } : {}),
    next_step: "/onboarding",
  });
}
