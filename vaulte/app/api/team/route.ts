import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiSuccess } from "@/lib/utils";
import { requireUser } from "@/lib/auth-guards";

export async function GET(req: NextRequest) {
  const g = await requireUser(req);
  if (g.response) return g.response;
  const [members, invites] = await Promise.all([
    db.user.findMany({ where: { organizationId: g.user.organizationId }, orderBy: { createdAt: "asc" } }),
    db.invite.findMany({ where: { organizationId: g.user.organizationId, acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
  ]);
  return apiSuccess({
    members: members.map(m => ({ id: m.id, name: m.name, email: m.email, role: m.role, status: m.status, mfa_enabled: m.mfaEnabled, last_login_at: m.lastLoginAt?.toISOString() ?? null })),
    invites: invites.map(i => ({ id: i.id, email: i.email, role: i.role, expires_at: i.expiresAt.toISOString() })),
  });
}
