// Safety net for partners that deliver webhooks at most once (Nium's default): for transfers that are waiting for money or being paid out, ask the
// partner directly and feed the answer through the same event path the webhook uses. Event ids are derived from the partner's own references, so a
// webhook and a poll of the same credit or payout are duplicates of each other, never two events.
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { customerRefFor } from "@/lib/partners/customers";
import { getPartner } from "@/lib/psp/stablecoin/registry";
import { processPartnerEvent } from "@/lib/stablecoin/service";
import type { Route } from "@/lib/stablecoin/types";

export interface ReconcileResult { fundingChecked: number; fundingApplied: number; payoutsChecked: number; payoutsApplied: number; errors: number }

export async function reconcilePartnerTransfers(limit = 100): Promise<ReconcileResult> {
  const out: ReconcileResult = { fundingChecked: 0, fundingApplied: 0, payoutsChecked: 0, payoutsApplied: 0, errors: 0 };
  const apply = async (partner: string, ev: Parameters<typeof processPartnerEvent>[1]) => (await processPartnerEvent(partner, ev)) === "processed";

  const waiting = await db.transfer.findMany({ where: { status: "AWAITING_FUNDS", fundingMethod: "FIAT_LOCAL" }, orderBy: { createdAt: "asc" }, take: limit });
  const seen = new Set<string>();
  for (const t of waiting) {
    const partnerId = (t.route as unknown as Route).legs[0]?.partner;
    try {
      const partner = partnerId ? getPartner(partnerId) : null;
      if (!partnerId || !partner?.listFundsReceived) continue;
      const customerRef = await customerRefFor(t.organizationId, partnerId, t.isSandbox);
      if (!customerRef || seen.has(`${partnerId}:${customerRef}:${t.sourceCurrency}`)) continue;
      seen.add(`${partnerId}:${customerRef}:${t.sourceCurrency}`);
      out.fundingChecked++;
      const since = waiting.filter(x => x.organizationId === t.organizationId).reduce((m, x) => (x.createdAt < m ? x.createdAt : m), t.createdAt);
      for (const c of await partner.listFundsReceived(customerRef, since)) {
        if (c.currency !== t.sourceCurrency) continue;
        if (await apply(partnerId, { id: `funds:${c.id}`, type: "customer.funds_received", data: { customer_ref: customerRef, currency: c.currency, amount_minor: c.amountMinor.toString(), credit_id: c.id, sender_name: c.senderName, bank_reference: c.bankReference } })) out.fundingApplied++;
      }
    } catch (e) { out.errors++; log("warn", "partner funding reconcile failed", { partner: partnerId, transfer: t.id, error: e instanceof Error ? e.message : String(e) }); }
  }

  const paying = await db.transfer.findMany({ where: { status: "PAYING_OUT", externalRef: { not: null } }, orderBy: { updatedAt: "asc" }, take: limit });
  for (const t of paying) {
    const legs = (t.route as unknown as Route).legs;
    const partnerId = legs[legs.length - 1]?.partner;
    try {
      const partner = partnerId ? getPartner(partnerId) : null;
      if (!partnerId || !partner?.getPayoutStatus) continue;
      out.payoutsChecked++;
      const st = await partner.getPayoutStatus(t.externalRef!, await customerRefFor(t.organizationId, partnerId, t.isSandbox));
      if (st.state === "PAID" && await apply(partnerId, { id: `payout:${t.externalRef}:paid`, type: "payout.completed", data: { transfer_ref: t.externalRef } })) out.payoutsApplied++;
      if (st.state === "FAILED" && await apply(partnerId, { id: `payout:${t.externalRef}:failed`, type: "payout.failed", data: { transfer_ref: t.externalRef, reason: st.reason ?? "partner payout failed" } })) out.payoutsApplied++;
    } catch (e) { out.errors++; log("warn", "partner payout reconcile failed", { partner: partnerId, transfer: t.id, error: e instanceof Error ? e.message : String(e) }); }
  }
  return out;
}
