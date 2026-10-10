// POST /api/exports/ack {provider:"TALLY", transfer_ids:[...], status:"SYNCED"|"FAILED", error?} — the Tally bridge reports what it imported.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiSuccess } from "@/lib/utils";
import { integrationContext } from "@/lib/erp/api";
import { parseJson } from "@/lib/kyc/api";

const Body = z.object({ provider: z.literal("TALLY"), transfer_ids: z.array(z.string()).min(1).max(500), status: z.enum(["SYNCED", "FAILED", "SKIPPED"]), error: z.string().max(500).optional() });

export async function POST(req: NextRequest) {
  const c = await integrationContext(req, { manage: false });
  if (c.response) return c.response;
  const b = await parseJson(req, Body);
  if (b.response) return b.response;
  const own = await db.transfer.findMany({ where: { id: { in: b.data.transfer_ids }, organizationId: c.orgId }, select: { id: true } });
  for (const t of own) {
    await db.erpSyncRecord.upsert({
      where: { organizationId_provider_transferId: { organizationId: c.orgId, provider: "TALLY", transferId: t.id } },
      create: { organizationId: c.orgId, provider: "TALLY", transferId: t.id, status: b.data.status, error: b.data.error ?? null, attempts: 1, syncedAt: b.data.status === "SYNCED" ? new Date() : null },
      update: { status: b.data.status, error: b.data.error ?? null, attempts: { increment: 1 }, syncedAt: b.data.status === "SYNCED" ? new Date() : null },
    });
  }
  await db.erpConnection.updateMany({ where: { organizationId: c.orgId, provider: "TALLY" }, data: { lastSyncAt: new Date(), lastError: b.data.status === "FAILED" ? b.data.error ?? "import failed" : null } });
  return apiSuccess({ acknowledged: own.length });
}
