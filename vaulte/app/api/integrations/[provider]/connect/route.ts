// POST — start connecting. OAuth providers return {url} to redirect the user to; Tally is connected directly (no OAuth).
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { configured, integrationContext, providerOf } from "@/lib/erp/api";
import { ADAPTERS } from "@/lib/erp/connectors";
import { redirectUri, signState } from "@/lib/erp/sync";

export async function POST(req: NextRequest, { params }: { params: { provider: string } }) {
  const p = providerOf(params.provider);
  if (!p) return apiError("NOT_FOUND", "Unknown integration", 404);
  const c = await integrationContext(req, { manage: true });
  if (c.response) return c.response;
  if (p === "TALLY") {
    const conn = await db.erpConnection.upsert({ where: { organizationId_provider: { organizationId: c.orgId, provider: "TALLY" } }, update: { status: "CONNECTED" }, create: { organizationId: c.orgId, provider: "TALLY", status: "CONNECTED", mapping: {} } });
    return apiSuccess({ connected: true, id: conn.id, next: "Run scripts/tally-bridge.mjs on the computer that runs Tally (see /dashboard/integrations)." });
  }
  if (!configured(p)) return apiError("NOT_CONFIGURED", `${ADAPTERS[p].label} is not enabled on this Vaulte deployment (the operator must register a developer app and set its client id/secret).`, 503);
  return apiSuccess({ url: ADAPTERS[p].authUrl(signState({ org: c.orgId, user: c.userId!, provider: p }), redirectUri(p)) });
}
