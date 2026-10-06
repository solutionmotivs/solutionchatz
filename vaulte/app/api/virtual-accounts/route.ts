// Virtual accounts (dashboard session or API key). Vaulte holds nothing: credits are swept at once, no balances are kept.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { readJson } from "@/lib/api-helpers";
import { invoiceAuth } from "@/lib/invoices/auth";
import { openVirtualAccount, presentVa, VaError } from "@/lib/virtual-accounts/service";

const Schema = z.object({
  entity_id: z.string(),
  country: z.string().length(2).toUpperCase(),
  currency: z.string().length(3).toUpperCase(),
  sweep_dest_currency: z.string().length(3).toUpperCase(),
  recipient_entity_id: z.string().optional(),
  default_purpose_code: z.string().regex(/^P\d{4}$/).optional(),
});

export async function POST(req: NextRequest) {
  const a = await invoiceAuth(req, true);
  if (a.response) return a.response;
  const body = await readJson(req);
  if (body === undefined) return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) { const e = parsed.error.errors[0]; return apiError("VALIDATION_ERROR", e.message, 400, e.path.join(".")); }
  const d = parsed.data;
  try {
    const va = await openVirtualAccount(a.organizationId, { entityId: d.entity_id, country: d.country, currency: d.currency, sweepDestCurrency: d.sweep_dest_currency, recipientEntityId: d.recipient_entity_id, defaultPurposeCode: d.default_purpose_code });
    return apiSuccess(presentVa(va), 201);
  } catch (e) {
    if (e instanceof VaError) return apiError(e.code, e.message, e.status, e.param);
    throw e;
  }
}

export async function GET(req: NextRequest) {
  const a = await invoiceAuth(req, false);
  if (a.response) return a.response;
  const rows = await db.virtualAccount.findMany({ where: { organizationId: a.organizationId }, orderBy: { createdAt: "desc" }, include: { entity: { select: { legalName: true } } } });
  return apiSuccess({ data: rows.map(r => presentVa(r, { holder: r.entity.legalName })) });
}
