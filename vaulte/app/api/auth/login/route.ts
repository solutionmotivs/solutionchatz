// POST /api/auth/login — password sign-in with lockout, unverified-email handling and optional second factor.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { DUMMY_HASH, verifyPassword } from "@/lib/security/password";
import { hit } from "@/lib/security/ratelimit-db";
import { clientIp } from "@/lib/session";
import { LOCK_AFTER_FAILURES, LOCK_MINUTES, completeLogin, publicUser, sendOtp } from "@/lib/auth-flows";
import { OtpError } from "@/lib/otp";

const Schema = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(128) });
const BAD = () => apiError("INVALID_CREDENTIALS", "Incorrect email or password", 401);

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = await hit(`login:ip:${ip}`, 30, 900);
  if (!lim.allowed) return apiError("RATE_LIMITED", "Too many attempts. Please try again later.", 429);

  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Invalid JSON", 400); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Email and password required", 400);
  const email = parsed.data.email.toLowerCase();

  const user = await db.user.findUnique({ where: { email }, include: { organization: { select: { name: true, slug: true, kybStatus: true } } } });
  if (!user) {
    await verifyPassword(parsed.data.password, DUMMY_HASH); // equalise timing
    return BAD();
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    return apiError("ACCOUNT_LOCKED", `Too many failed attempts. Try again in ${Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000)} minutes, or reset your password.`, 423);
  }
  const ok = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!ok) {
    const failures = user.failedLoginCount + 1;
    await db.user.update({
      where: { id: user.id },
      data: { failedLoginCount: failures, ...(failures >= LOCK_AFTER_FAILURES ? { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000), failedLoginCount: 0 } : {}) },
    });
    if (failures >= LOCK_AFTER_FAILURES) {
      await db.auditLog.create({ data: { action: "login.locked", resourceType: "User", resourceId: user.id, organizationId: user.organizationId, userId: user.id } });
    }
    return BAD();
  }
  if (user.status !== "ACTIVE") return apiError("ACCOUNT_SUSPENDED", "This account is suspended. Contact support.", 403);

  if (!user.emailVerifiedAt) {
    let devCode: string | undefined;
    try { devCode = (await sendOtp(req, { purpose: "SIGNUP_VERIFY", email, name: user.name, userId: user.id })).devCode; } catch (e) { if (!(e instanceof OtpError)) throw e; }
    return apiError("EMAIL_NOT_VERIFIED", "Verify your email first. We sent you a new code.", 403, undefined, devCode ? { dev_code: devCode } : undefined);
  }

  await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  const r = await completeLogin(req, user, "PASSWORD");
  if (r.kind === "mfa") return apiSuccess({ status: "totp_required", mfa_token: r.mfaToken });
  await db.auditLog.create({ data: { action: "login.success", resourceType: "User", resourceId: user.id, organizationId: user.organizationId, userId: user.id, ipAddress: ip } });
  return apiSuccess({
    status: "ok",
    user: { ...publicUser(user), organization: { id: user.organizationId, name: user.organization.name, slug: user.organization.slug, kyb_status: user.organization.kybStatus } },
  });
}
