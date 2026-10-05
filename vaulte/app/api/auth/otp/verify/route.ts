// POST /api/auth/otp/verify — finish passwordless sign-in. Second factor still applies when enabled.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { verifyOtp, OtpError } from "@/lib/otp";
import { clientIp } from "@/lib/session";
import { completeLogin, publicUser } from "@/lib/auth-flows";

const Schema = z.object({ email: z.string().trim().email(), code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code") });

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Invalid JSON", 400); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.errors[0].message, 400);
  const email = parsed.data.email.toLowerCase();
  try {
    await verifyOtp({ purpose: "LOGIN", email, code: parsed.data.code, ip: clientIp(req) });
  } catch (e) {
    if (e instanceof OtpError) return apiError(e.code, e.message, e.code === "RATE_LIMITED" ? 429 : 400);
    throw e;
  }
  const user = await db.user.findUnique({ where: { email }, include: { organization: { select: { name: true, slug: true, kybStatus: true } } } });
  if (!user || user.status !== "ACTIVE" || !user.emailVerifiedAt) return apiError("INVALID_CODE", "Invalid or expired code", 400);
  const r = await completeLogin(req, user, "EMAIL_OTP");
  if (r.kind === "mfa") return apiSuccess({ status: "totp_required", mfa_token: r.mfaToken });
  await db.auditLog.create({ data: { action: "login.success", resourceType: "User", resourceId: user.id, organizationId: user.organizationId, userId: user.id, metadata: { method: "EMAIL_OTP" } } });
  return apiSuccess({ status: "ok", user: { ...publicUser(user), organization: { id: user.organizationId, name: user.organization.name, slug: user.organization.slug, kyb_status: user.organization.kybStatus } } });
}
