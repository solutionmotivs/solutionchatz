// POST /api/auth/register — creates an UNVERIFIED account and emails a one-time code. No session until the code is verified.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess, sanitizeSlug } from "@/lib/utils";
import { hashPassword, validatePassword } from "@/lib/security/password";
import { hit } from "@/lib/security/ratelimit-db";
import { clientIp } from "@/lib/session";
import { sendOtp, TERMS_VERSION } from "@/lib/auth-flows";
import { OtpError } from "@/lib/otp";
import { sendEmail } from "@/lib/email/sender";
import { securityNoticeEmail } from "@/lib/email/templates";


const Schema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  password: z.string().min(10).max(128),
  account_type: z.enum(["BUSINESS", "INDIVIDUAL"]).default("BUSINESS"),
  company_name: z.string().trim().min(2).max(200).optional(),
  country: z.string().length(2).toUpperCase(),
  accept_terms: z.literal(true, { errorMap: () => ({ message: "You must accept the Terms and Privacy Policy" }) }),
  marketing_opt_in: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const lim = await hit(`register:ip:${ip}`, 10, 3600);
  if (!lim.allowed) return apiError("RATE_LIMITED", "Too many sign-up attempts. Please try again later.", 429);

  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Invalid JSON", 400); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    const e = parsed.error.errors[0];
    return apiError("VALIDATION_ERROR", e.message, 400, e.path.join("."));
  }
  const d = parsed.data;
  const email = d.email.toLowerCase();
  if (d.account_type === "BUSINESS" && !d.company_name) return apiError("VALIDATION_ERROR", "Company name is required for business accounts", 400, "company_name");
  const pwErr = validatePassword(d.password, { email, name: d.name });
  if (pwErr) return apiError("WEAK_PASSWORD", pwErr, 400, "password");

  const generic = { status: "verification_required", email, message: "If this email can be used, we sent a 6-digit code to it." };
  const existing = await db.user.findUnique({ where: { email } });
  try {
    if (existing?.emailVerifiedAt) {
      // Do not reveal that the account exists; tell the owner instead.
      await sendEmail({ to: email, template: securityNoticeEmail({ name: existing.name, event: "Someone tried to create an account with your email", detail: "If this was you, sign in or reset your password instead." }) });
      return apiSuccess(generic, 202);
    }

    const passwordHash = await hashPassword(d.password);
    const orgName = d.account_type === "INDIVIDUAL" ? d.name : d.company_name!;
    let userId: string;
    if (existing) {
      // Never verified: whoever proves email ownership next wins, so refreshing the credentials is safe.
      await db.user.update({ where: { id: existing.id }, data: { passwordHash, name: d.name, termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION, marketingOptIn: d.marketing_opt_in } });
      await db.organization.update({ where: { id: existing.organizationId }, data: { name: orgName, country: d.country, accountType: d.account_type } });
      userId = existing.id;
    } else {
      let slug = sanitizeSlug(orgName) || "account";
      if (await db.organization.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36)}`;
      const user = await db.$transaction(async tx => {
        const org = await tx.organization.create({
          data: { name: orgName, slug, country: d.country, accountType: d.account_type, kybStatus: "NOT_STARTED", planId: "FREE", sandboxEnabled: true, onboardingStep: "COMPANY_DETAILS" },
        });
        return tx.user.create({
          data: {
            name: d.name, email, passwordHash, role: "OWNER", organizationId: org.id, passwordChangedAt: new Date(),
            termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION, marketingOptIn: d.marketing_opt_in,
          },
        });
      });
      userId = user.id;
      await db.auditLog.create({ data: { action: "account.registered", resourceType: "User", resourceId: user.id, organizationId: user.organizationId, userId: user.id, metadata: { country: d.country, account_type: d.account_type } } });
    }

    const r = await sendOtp(req, { purpose: "SIGNUP_VERIFY", email, name: d.name, userId });
    if (!r.sent) return apiError("EMAIL_UNAVAILABLE", "We could not send the verification email. Please try again shortly.", 503);
    return apiSuccess({ ...generic, ...(r.devCode ? { dev_code: r.devCode } : {}) }, 202);
  } catch (e) {
    if (e instanceof OtpError) return apiError(e.code, e.message, 429);
    throw e;
  }
}
