// POST /api/auth/terms — the signed-in user accepts the current Terms/Privacy/AML versions (re-acceptance after a change).
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth-guards";
import { apiSuccess } from "@/lib/utils";
import { TERMS_VERSION } from "@/lib/auth-flows";

export async function POST(req: NextRequest) {
  const g = await requireUser(req);
  if (g.response) return g.response;
  await db.user.update({ where: { id: g.user.id }, data: { termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION } });
  await db.auditLog.create({ data: { organizationId: g.user.organizationId, userId: g.user.id, action: "terms.accepted", resourceType: "User", resourceId: g.user.id, metadata: { version: TERMS_VERSION } } });
  return apiSuccess({ terms_version: TERMS_VERSION });
}
