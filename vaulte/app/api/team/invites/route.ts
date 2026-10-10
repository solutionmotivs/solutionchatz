import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { requireUser } from "@/lib/auth-guards";
import { randomToken, sha256Hex } from "@/lib/security/crypto";
import { sendEmail } from "@/lib/email/sender";
import { inviteEmail } from "@/lib/email/templates";
import { exposeDevOtp } from "@/lib/otp";
import { hit } from "@/lib/security/ratelimit-db";

const Schema = z.object({ email: z.string().trim().email().max(254), role: z.enum(["ADMIN", "FINANCE", "DEVELOPER", "READ_ONLY"]) });

export async function POST(req: NextRequest) {
  const g = await requireUser(req, { roles: ["OWNER", "ADMIN"] });
  if (g.response) return g.response;
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Invalid JSON", 400); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.errors[0].message, 400);
  if (parsed.data.role === "ADMIN" && g.user.role !== "OWNER") return apiError("FORBIDDEN", "Only the owner can invite admins", 403);
  if (!(await hit(`invite:${g.user.organizationId}`, 20, 3600)).allowed) return apiError("RATE_LIMITED", "Too many invitations. Try again later.", 429);
  const email = parsed.data.email.toLowerCase();
  if (await db.user.findUnique({ where: { email } })) return apiError("EMAIL_TAKEN", "That email already has an account", 409);

  const token = randomToken();
  const invite = await db.invite.create({
    data: { email, role: parsed.data.role, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + 7 * 24 * 3600_000), invitedByUserId: g.user.id, organizationId: g.user.organizationId },
  });
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  await sendEmail({ to: email, organizationId: g.user.organizationId, template: inviteEmail({ inviterName: g.user.name, orgName: g.user.organizationName, role: parsed.data.role, acceptUrl: `${base}/accept-invite?token=${token}` }) });
  await db.auditLog.create({ data: { action: "team.invited", resourceType: "Invite", resourceId: invite.id, organizationId: g.user.organizationId, userId: g.user.id, metadata: { role: parsed.data.role } } });
  return apiSuccess({ id: invite.id, email, role: invite.role, expires_at: invite.expiresAt.toISOString(), ...(exposeDevOtp() ? { dev_token: token } : {}) }, 201);
}
