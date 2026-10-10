// POST /api/team/invites/accept — public. The emailed token proves control of the invited address.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { sha256Hex } from "@/lib/security/crypto";
import { hashPassword, validatePassword } from "@/lib/security/password";
import { hit } from "@/lib/security/ratelimit-db";
import { clientIp, startSession } from "@/lib/session";
import { publicUser } from "@/lib/auth-flows";
import { TERMS_VERSION } from "@/lib/auth-flows";

const Schema = z.object({
  token: z.string().min(20).max(200), name: z.string().trim().min(2).max(80), password: z.string().min(10).max(128),
  accept_terms: z.literal(true, { errorMap: () => ({ message: "You must accept the Terms and Privacy Policy" }) }),
});

export async function POST(req: NextRequest) {
  if (!(await hit(`invite-accept:${clientIp(req)}`, 20, 3600)).allowed) return apiError("RATE_LIMITED", "Too many attempts", 429);
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Invalid JSON", 400); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.errors[0].message, 400, parsed.error.errors[0].path.join("."));
  const invite = await db.invite.findUnique({ where: { tokenHash: sha256Hex(parsed.data.token) } });
  if (!invite || invite.acceptedAt || invite.expiresAt.getTime() < Date.now()) return apiError("INVALID_INVITE", "This invitation is invalid or has expired", 400);
  const pwErr = validatePassword(parsed.data.password, { email: invite.email, name: parsed.data.name });
  if (pwErr) return apiError("WEAK_PASSWORD", pwErr, 400, "password");
  if (await db.user.findUnique({ where: { email: invite.email } })) return apiError("EMAIL_TAKEN", "That email already has an account", 409);

  const claimed = await db.invite.updateMany({ where: { id: invite.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
  if (claimed.count !== 1) return apiError("INVALID_INVITE", "This invitation is invalid or has expired", 400);
  const user = await db.user.create({
    data: {
      name: parsed.data.name, email: invite.email, passwordHash: await hashPassword(parsed.data.password), role: invite.role, organizationId: invite.organizationId,
      emailVerifiedAt: new Date(), passwordChangedAt: new Date(), termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION,
    },
  });
  await startSession(user, req, { method: "INVITE", mfa: false });
  await db.auditLog.create({ data: { action: "team.joined", resourceType: "User", resourceId: user.id, organizationId: user.organizationId, userId: user.id } });
  return apiSuccess({ status: "ok", user: publicUser(user), next_step: "/dashboard" }, 201);
}
