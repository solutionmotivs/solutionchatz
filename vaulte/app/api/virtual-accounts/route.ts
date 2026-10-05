// Virtual accounts: local receiving details issued by a licensed partner, per customer per country.
// Vaulte holds nothing. Every credit is swept immediately (convert + pay out); no balances are kept.
import { NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { verifyApiKey } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { readJson } from "@/lib/api-helpers";
import { MOCK_LEGS } from "@/lib/routing/catalog";
import { getPartner } from "@/lib/psp/stablecoin/registry";

const Schema = z.object({
  entity_id: z.string(),
  country: z.string().length(2).toUpperCase(),
  currency: z.string().length(3).toUpperCase(),
  sweep_dest_currency: z.string().length(3).toUpperCase(),
  recipient_entity_id: z.string().optional(),
  default_purpose_code: z.string().regex(/^P\d{4}$/).optional(),
});

/** First (primary) partner that can receive this currency. Real deployments: partner capability API. */
function partnerFor(currency: string): string | null {
  const leg = MOCK_LEGS.find(l => l.kind === "ONRAMP_FIAT" && l.srcCurrency === currency && !l.partner.endsWith("_b"));
  return leg?.partner ?? null;
}

export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req.headers.get("authorization"));
  if (!auth) return apiError("UNAUTHORIZED", "Invalid or missing API key", 401);
  if (!auth.scopes.includes("payments:write")) return apiError("FORBIDDEN", "API key missing payments:write scope", 403);
  const body = await readJson(req);
  if (body === undefined) return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    const e = parsed.error.errors[0];
    return apiError("VALIDATION_ERROR", e.message, 400, e.path.join("."));
  }
  const d = parsed.data;

  const entity = await db.entity.findFirst({ where: { id: d.entity_id, organizationId: auth.organizationId } });
  if (!entity) return apiError("NOT_FOUND", "Entity not found", 404, "entity_id");
  if (entity.verificationStatus !== "APPROVED") {
    return apiError("ENTITY_NOT_VERIFIED", "The account holder must complete KYB/KYC with the partner first", 403);
  }
  if (d.recipient_entity_id) {
    const r = await db.entity.findFirst({ where: { id: d.recipient_entity_id, organizationId: auth.organizationId } });
    if (!r) return apiError("NOT_FOUND", "Recipient entity not found", 404, "recipient_entity_id");
  }
  // Residents of India generally cannot hold foreign-currency balances abroad: collection-only, INR sweep.
  if (entity.country === "IN" && d.sweep_dest_currency !== "INR") {
    return apiError("INDIA_COLLECTION_ONLY", "Accounts for Indian residents must sweep to INR immediately", 422, "sweep_dest_currency");
  }
  if (d.sweep_dest_currency === d.currency) {
    return apiError("VALIDATION_ERROR", "sweep_dest_currency must differ from the account currency", 400, "sweep_dest_currency");
  }
  const partnerId = partnerFor(d.currency);
  if (!partnerId) return apiError("NO_PARTNER", `No partner currently issues ${d.currency} accounts`, 422, "currency");

  const existing = await db.virtualAccount.findUnique({
    where: { entityId_country_currency: { entityId: entity.id, country: d.country, currency: d.currency } },
  });
  if (existing) return apiError("ALREADY_EXISTS", "A virtual account for this country and currency already exists", 409);

  try {
    const issued = await getPartner(partnerId).createVirtualAccount({
      entityId: entity.id, legalName: entity.legalName, country: d.country, currency: d.currency,
    });
    const va = await db.virtualAccount.create({
      data: {
        partner: partnerId, partnerRef: issued.partnerRef, country: d.country, currency: d.currency,
        details: issued.details as Prisma.InputJsonValue,
        sweepRule: { mode: "AUTO_SWEEP", destCurrency: d.sweep_dest_currency, recipientEntityId: d.recipient_entity_id ?? entity.id, defaultPurposeCode: d.default_purpose_code ?? null },
        collectionOnly: true, organizationId: auth.organizationId, entityId: entity.id,
      },
    });
    return apiSuccess(serialize(va), 201);
  } catch (e) {
    console.error("virtual account creation failed", e);
    return apiError("PARTNER_ERROR", "Could not open the account with the partner", 502);
  }
}

export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req.headers.get("authorization"));
  if (!auth) return apiError("UNAUTHORIZED", "Invalid or missing API key", 401);
  const rows = await db.virtualAccount.findMany({ where: { organizationId: auth.organizationId }, orderBy: { createdAt: "desc" } });
  return apiSuccess({ data: rows.map(serialize) });
}

function serialize(va: { id: string; partner: string; country: string; currency: string; details: unknown; status: string; sweepRule: unknown; collectionOnly: boolean; entityId: string; createdAt: Date }) {
  return {
    id: va.id, entity_id: va.entityId, country: va.country, currency: va.currency, status: va.status,
    account_details: va.details, sweep_rule: va.sweepRule, collection_only: va.collectionOnly, created_at: va.createdAt.toISOString(),
    note: "Held by the licensed partner in the account holder's name; credits are converted and paid out immediately.",
  };
}
