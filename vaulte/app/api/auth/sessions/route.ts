import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiSuccess } from "@/lib/utils";
import { requireUser } from "@/lib/auth-guards";
import { deviceLabel } from "@/lib/session";

export async function GET(req: NextRequest) {
  const g = await requireUser(req);
  if (g.response) return g.response;
  const rows = await db.session.findMany({
    where: { userId: g.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
  });
  return apiSuccess({
    data: rows.map(s => ({
      id: s.id, device: deviceLabel(s.userAgent), ip: s.ipAddress, method: s.method, mfa: s.mfa,
      created_at: s.createdAt.toISOString(), last_seen_at: s.lastSeenAt?.toISOString() ?? null, current: s.id === g.user.sessionId,
    })),
  });
}
