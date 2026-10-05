import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { integrationContext, providerOf } from "@/lib/erp/api";

export async function GET(req: NextRequest, { params }: { params: { provider: string } }) {
  const p = providerOf(params.provider);
  if (!p) return apiError("NOT_FOUND", "Unknown integration", 404);
  const c = await integrationContext(req);
  if (c.response) return c.response;
  const status = req.nextUrl.searchParams.get("status");
  const rows = await db.erpSyncRecord.findMany({ where: { organizationId: c.orgId, provider: p, ...(status ? { status } : {}) }, orderBy: { updatedAt: "desc" }, take: 100 });
  return apiSuccess({ data: rows.map(r => ({ transfer_id: r.transferId, status: r.status, external_id: r.externalId, error: r.error, attempts: r.attempts, synced_at: r.syncedAt })) });
}
