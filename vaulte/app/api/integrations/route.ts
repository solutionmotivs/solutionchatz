// GET /api/integrations — which accounting systems are available, which are connected, and their mapping.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiSuccess } from "@/lib/utils";
import { PROVIDERS, configured, integrationContext } from "@/lib/erp/api";
import { ADAPTERS } from "@/lib/erp/connectors";

export async function GET(req: NextRequest) {
  const c = await integrationContext(req);
  if (c.response) return c.response;
  const conns = await db.erpConnection.findMany({ where: { organizationId: c.orgId } });
  const counts = await db.erpSyncRecord.groupBy({ by: ["provider", "status"], where: { organizationId: c.orgId }, _count: true });
  return apiSuccess({
    data: PROVIDERS.map(p => {
      const conn = conns.find(x => x.provider === p);
      const n = (s: string) => counts.find(x => x.provider === p && x.status === s)?._count ?? 0;
      return { provider: p, label: p === "TALLY" ? "Tally (XML via local bridge)" : ADAPTERS[p].label, available: configured(p), connected: conn?.status === "CONNECTED", status: conn?.status ?? "NOT_CONNECTED", tenant: conn?.tenant ?? null, mapping: conn?.mapping ?? {}, last_sync_at: conn?.lastSyncAt ?? null, last_error: conn?.lastError ?? null, synced: n("SYNCED"), failed: n("FAILED"), skipped: n("SKIPPED") };
    }),
  });
}
