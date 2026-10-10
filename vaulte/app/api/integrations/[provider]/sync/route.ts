import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { integrationContext, providerOf } from "@/lib/erp/api";
import { syncConnection } from "@/lib/erp/sync";
import { hit } from "@/lib/security/ratelimit-db";

/** POST — push completed, not-yet-synced transfers now (also retries earlier failures). */
export async function POST(req: NextRequest, { params }: { params: { provider: string } }) {
  const p = providerOf(params.provider);
  if (!p || p === "TALLY") return apiError("NOT_FOUND", "Unknown integration (Tally syncs through the bridge)", 404);
  const c = await integrationContext(req, { manage: true });
  if (c.response) return c.response;
  if (!(await hit(`erp:sync:${c.orgId}:${p}`, 20, 3600)).allowed) return apiError("RATE_LIMITED", "Too many sync requests", 429);
  const conn = await db.erpConnection.findUnique({ where: { organizationId_provider: { organizationId: c.orgId, provider: p } } });
  if (!conn || conn.status !== "CONNECTED") return apiError("NOT_CONNECTED", conn?.status === "NEEDS_REAUTH" ? "Reconnect this integration" : "Not connected", 409);
  return apiSuccess(await syncConnection(conn.id));
}
