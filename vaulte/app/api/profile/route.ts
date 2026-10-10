import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { requireUser } from "@/lib/auth-guards";

const Patch = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  phone: z.string().trim().regex(/^\+?[0-9 \-()]{6,20}$/, "Enter a valid phone number").nullable().optional(),
  job_title: z.string().trim().max(80).nullable().optional(),
  timezone: z.string().trim().max(60).optional(),
  locale: z.string().trim().max(10).optional(),
  marketing_opt_in: z.boolean().optional(),
});

async function view(userId: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { organization: true } });
  return {
    id: u.id, name: u.name, email: u.email, email_verified: !!u.emailVerifiedAt, role: u.role, phone: u.phone, job_title: u.jobTitle,
    timezone: u.timezone, locale: u.locale, mfa_enabled: u.mfaEnabled, marketing_opt_in: u.marketingOptIn,
    created_at: u.createdAt.toISOString(), last_login_at: u.lastLoginAt?.toISOString() ?? null, password_changed_at: u.passwordChangedAt?.toISOString() ?? null,
    organization: { id: u.organization.id, name: u.organization.name, account_type: u.organization.accountType, country: u.organization.country, kyb_status: u.organization.kybStatus },
  };
}

export async function GET(req: NextRequest) {
  const g = await requireUser(req);
  if (g.response) return g.response;
  return apiSuccess(await view(g.user.id));
}

export async function PATCH(req: NextRequest) {
  const g = await requireUser(req);
  if (g.response) return g.response;
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Invalid JSON", 400); }
  const parsed = Patch.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.errors[0].message, 400, parsed.error.errors[0].path.join("."));
  const d = parsed.data;
  await db.user.update({
    where: { id: g.user.id },
    data: {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.phone !== undefined ? { phone: d.phone } : {}),
      ...(d.job_title !== undefined ? { jobTitle: d.job_title } : {}),
      ...(d.timezone !== undefined ? { timezone: d.timezone } : {}),
      ...(d.locale !== undefined ? { locale: d.locale } : {}),
      ...(d.marketing_opt_in !== undefined ? { marketingOptIn: d.marketing_opt_in } : {}),
    },
  });
  await db.auditLog.create({ data: { action: "profile.updated", resourceType: "User", resourceId: g.user.id, organizationId: g.user.organizationId, userId: g.user.id, metadata: { fields: Object.keys(d) } } });
  return apiSuccess(await view(g.user.id));
}
