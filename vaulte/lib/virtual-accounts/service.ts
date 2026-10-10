// Virtual accounts: local receiving details issued by a licensed partner, per customer per country/currency.
// Vaulte holds nothing. Every credit is swept immediately (convert + pay out); no balances are kept.
import { customerRefFor } from "@/lib/partners/customers";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { vaPartnerFor } from "@/lib/psp/capabilities";
import { getPartner } from "@/lib/psp/stablecoin/registry";

export class VaError extends Error {
  constructor(public code: string, message: string, public status = 400, public param?: string) { super(message); }
}

export interface OpenVaInput { entityId: string; country: string; currency: string; sweepDestCurrency: string; recipientEntityId?: string; defaultPurposeCode?: string }

export async function openVirtualAccount(organizationId: string, d: OpenVaInput) {
  const entity = await db.entity.findFirst({ where: { id: d.entityId, organizationId } });
  if (!entity) throw new VaError("NOT_FOUND", "Entity not found", 404, "entity_id");
  if (entity.verificationStatus !== "APPROVED") throw new VaError("ENTITY_NOT_VERIFIED", "The account holder must complete KYB/KYC with the partner first", 403);
  if (d.recipientEntityId && !(await db.entity.findFirst({ where: { id: d.recipientEntityId, organizationId } }))) throw new VaError("NOT_FOUND", "Recipient entity not found", 404, "recipient_entity_id");
  // Residents of India generally cannot hold foreign-currency balances abroad: collection-only, INR sweep.
  if (entity.country === "IN" && d.sweepDestCurrency !== "INR") throw new VaError("INDIA_COLLECTION_ONLY", "Accounts for Indian residents must sweep to INR immediately", 422, "sweep_dest_currency");
  if (d.sweepDestCurrency === d.currency) throw new VaError("VALIDATION_ERROR", "sweep_dest_currency must differ from the account currency", 400, "sweep_dest_currency");

  // Test mode (account not yet approved) uses simulated partners only; live uses only contracted, configured partners.
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { kybStatus: true } });
  const sandbox = org?.kybStatus !== "APPROVED";
  const match = vaPartnerFor(d.currency, d.country, sandbox);
  if (!match) throw new VaError("NO_PARTNER", `No partner can currently issue ${d.currency} accounts in ${d.country}${sandbox ? "" : " for live accounts"}`, 422, "currency");

  const existing = await db.virtualAccount.findUnique({ where: { entityId_country_currency: { entityId: entity.id, country: d.country, currency: d.currency } } });
  if (existing) throw new VaError("ALREADY_EXISTS", "A virtual account for this country and currency already exists", 409);
  try {
    const issued = await getPartner(match.partner).createVirtualAccount({ entityId: entity.id, legalName: entity.legalName, country: d.country, currency: d.currency, customerRef: await customerRefFor(organizationId, match.partner, sandbox) });
    return await db.virtualAccount.create({
      data: {
        partner: match.partner, partnerRef: issued.partnerRef, country: d.country, currency: d.currency, details: issued.details as Prisma.InputJsonValue,
        sweepRule: { mode: "AUTO_SWEEP", destCurrency: d.sweepDestCurrency, recipientEntityId: d.recipientEntityId ?? entity.id, defaultPurposeCode: d.defaultPurposeCode ?? null },
        collectionOnly: true, organizationId, entityId: entity.id,
      },
    });
  } catch (e) {
    log("error", "virtual account creation failed", { error: e });
    throw new VaError("PARTNER_ERROR", "Could not open the account with the partner", 502);
  }
}

type Row = { id: string; partner: string; country: string; currency: string; details: unknown; status: string; sweepRule: unknown; collectionOnly: boolean; entityId: string; createdAt: Date };
export function presentVa(va: Row, extra: Record<string, unknown> = {}) {
  return {
    id: va.id, entity_id: va.entityId, country: va.country, currency: va.currency, status: va.status,
    account_details: va.details, sweep_rule: va.sweepRule, collection_only: va.collectionOnly, simulated: va.partner.startsWith("mock_"), created_at: va.createdAt.toISOString(),
    note: "Held by the licensed partner in the account holder's name; credits are converted and paid out immediately. Vaulte keeps no balance.",
    ...extra,
  };
}

/** Credits are the transfers each credit created: status shows where it is in convert-and-pay-out. */
export async function listCredits(organizationId: string, vaId: string, take = 50) {
  const rows = await db.transfer.findMany({
    where: { organizationId, fundingMethod: "VIRTUAL_ACCOUNT", fundingInstructions: { path: ["virtual_account_id"], equals: vaId } },
    orderBy: { createdAt: "desc" }, take,
    select: { id: true, status: true, statusReason: true, sourceCurrency: true, sourceAmount: true, destCurrency: true, destAmount: true, createdAt: true, completedAt: true, fundedAt: true, sender: { select: { legalName: true, country: true } } },
  });
  return rows.map(t => ({
    transfer_id: t.id, status: t.status, status_reason: t.statusReason, payer: t.sender.legalName, payer_country: t.sender.country,
    received: { currency: t.sourceCurrency, amount: Number(t.sourceAmount) }, paid_out: { currency: t.destCurrency, amount: Number(t.destAmount) },
    credited_at: t.createdAt.toISOString(), completed_at: t.completedAt?.toISOString() ?? null,
    seconds_to_complete: t.completedAt && t.fundedAt ? Math.round((t.completedAt.getTime() - t.fundedAt.getTime()) / 1000) : null,
  }));
}
