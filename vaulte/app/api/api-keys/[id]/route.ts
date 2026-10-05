import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { requireUser } from "@/lib/auth-guards";

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireUser(req, { roles: ["OWNER", "ADMIN", "DEVELOPER"] });
  if (g.response) return g.response;
  const k = await db.apiKey.findFirst({ where: { id: params.id, organizationId: g.user.organizationId } });
  if (!k) return apiError("NOT_FOUND", "API key not found", 404);
  await db.apiKey.delete({ where: { id: k.id } });
  await db.auditLog.create({ data: { action: "apikey.revoked", resourceType: "ApiKey", resourceId: k.id, organizationId: g.user.organizationId, userId: g.user.id } });
  return apiSuccess({ status: "revoked" });
}
