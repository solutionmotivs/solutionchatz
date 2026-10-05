import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { integrationContext, providerOf } from "@/lib/erp/api";

/** DELETE — disconnect and forget the stored tokens (history is kept). */
export async function DELETE(req: NextRequest, { params }: { params: { provider: string } }) {
  const p = providerOf(params.provider);
  if (!p) return apiError("NOT_FOUND", "Unknown integration", 404);
  const c = await integrationContext(req, { manage: true });
  if (c.response) return c.response;
  const r = await db.erpConnection.updateMany({ where: { organizationId: c.orgId, provider: p }, data: { status: "DISCONNECTED", accessEnc: null, refreshEnc: null, expiresAt: null } });
  if (!r.count) return apiError("NOT_FOUND", "Not connected", 404);
  await db.auditLog.create({ data: { organizationId: c.orgId, userId: c.userId ?? null, action: "erp.disconnected", resourceType: "ErpConnection", resourceId: p } });
  return apiSuccess({ disconnected: true });
}
