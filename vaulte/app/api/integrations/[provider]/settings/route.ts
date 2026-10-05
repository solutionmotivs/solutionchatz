import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { integrationContext, providerOf } from "@/lib/erp/api";
import { parseJson } from "@/lib/kyc/api";

const Body = z.object({
  bank: z.string().min(1).max(100).optional(), charges: z.string().min(1).max(100).optional(), party: z.string().min(1).max(100).optional(),
  base_currency: z.string().length(3).toUpperCase().optional(), create_masters: z.boolean().optional(), company: z.string().max(100).optional(),
  sync_from: z.string().optional(),
});

/** PUT — map accounts/ledgers (names for Tally, ids for QuickBooks/Zoho, codes for Xero) and options. */
export async function PUT(req: NextRequest, { params }: { params: { provider: string } }) {
  const p = providerOf(params.provider);
  if (!p) return apiError("NOT_FOUND", "Unknown integration", 404);
  const c = await integrationContext(req, { manage: true });
  if (c.response) return c.response;
  const b = await parseJson(req, Body);
  if (b.response) return b.response;
  const conn = await db.erpConnection.findUnique({ where: { organizationId_provider: { organizationId: c.orgId, provider: p } } });
  if (!conn) return apiError("NOT_FOUND", "Connect this integration first", 404);
  const { sync_from, ...mapping } = b.data;
  await db.erpConnection.update({ where: { id: conn.id }, data: { mapping: { ...(conn.mapping as object), ...mapping }, ...(sync_from ? { syncFrom: new Date(sync_from) } : {}) } });
  return apiSuccess({ saved: true });
}
