// Delegated onboarding: Vaulte runs KYC/KYB and sends the approved package to the licensed partner, which is the provider of record and decides.
// Live money moves through a partner only when the customer is APPROVED there. Test mode uses sandbox partners that auto-approve so the flow is visible.
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { getPartner } from "@/lib/psp/stablecoin/registry";
import type { CustomerPackage, PartnerCustomerResult } from "@/lib/psp/stablecoin/partner";
import type { Route } from "@/lib/stablecoin/types";

export const PARTNER_STATUSES = ["INVITED", "SUBMITTED", "NEEDS_INFO", "APPROVED", "REJECTED"] as const;
export type PartnerCustomerStatus = (typeof PARTNER_STATUSES)[number];

export const partnersOf = (route: Route) => Array.from(new Set(route.legs.map(l => l.partner)));

async function packageFor(orgId: string): Promise<CustomerPackage> {
  const o = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  return { organizationId: o.id, legalName: o.legalName ?? o.name, country: o.country ?? "", registrationNumber: o.registrationNumber, taxId: o.taxId, businessType: o.businessType, riskTier: o.riskTier, kybApprovedAt: o.kybApprovedAt?.toISOString() ?? null };
}

function apply(res: PartnerCustomerResult) {
  const decided = res.status === "APPROVED" || res.status === "REJECTED";
  return { partnerRef: res.partnerRef, status: res.status, note: res.note ?? null, ...(decided ? { decidedAt: new Date() } : {}) };
}

/** Start (or return) the customer's onboarding at one partner. Idempotent; never downgrades an APPROVED customer. */
export async function submitToPartner(orgId: string, partnerId: string, sandbox: boolean) {
  const key = { organizationId_partner_sandbox: { organizationId: orgId, partner: partnerId, sandbox } };
  const existing = await db.partnerCustomer.findUnique({ where: key });
  if (existing && existing.status !== "INVITED" && existing.status !== "NEEDS_INFO") return existing;
  const row = existing ?? await db.partnerCustomer.create({ data: { organizationId: orgId, partner: partnerId, sandbox } });
  const adapter = getPartner(partnerId);
  if (!adapter.submitCustomer) {
    // No onboarding API: the partner is told out of band; staff mark the decision here once the partner confirms.
    return db.partnerCustomer.update({ where: { id: row.id }, data: { status: "SUBMITTED", submittedAt: new Date(), note: "Waiting for the partner's decision (no onboarding API; staff record it)" } });
  }
  try {
    const res = await adapter.submitCustomer(await packageFor(orgId));
    return await db.partnerCustomer.update({ where: { id: row.id }, data: { submittedAt: new Date(), ...apply(res) } });
  } catch (e) {
    log("warn", "partner customer submit failed", { partner: partnerId, error: e instanceof Error ? e.message : String(e) });
    return db.partnerCustomer.update({ where: { id: row.id }, data: { status: "INVITED", note: "Submission failed; will retry" } });
  }
}

/** Refresh SUBMITTED customers from partners that expose a status call. Run by the scheduler. */
export async function refreshPartnerCustomers(): Promise<{ checked: number; changed: number }> {
  const rows = await db.partnerCustomer.findMany({ where: { status: "SUBMITTED", partnerRef: { not: null } }, take: 200 });
  let changed = 0;
  for (const r of rows) {
    try {
      const adapter = getPartner(r.partner);
      if (!adapter.getCustomerStatus) continue;
      const res = await adapter.getCustomerStatus(r.partnerRef!);
      if (res.status !== r.status) { await db.partnerCustomer.update({ where: { id: r.id }, data: apply(res) }); changed++; }
    } catch (e) { log("warn", "partner customer refresh failed", { partner: r.partner, error: e instanceof Error ? e.message : String(e) }); }
  }
  return { checked: rows.length, changed };
}

export interface PartnerOnboarding { partner: string; status: PartnerCustomerStatus | "NOT_STARTED"; note: string | null }

/** Status of every partner a route uses. In test mode sandbox partners are treated as approved without writing anything. */
export async function onboardingFor(orgId: string, route: Route, sandbox: boolean): Promise<PartnerOnboarding[]> {
  const partners = partnersOf(route);
  const rows = await db.partnerCustomer.findMany({ where: { organizationId: orgId, sandbox, partner: { in: partners } } });
  return partners.map(p => {
    const r = rows.find(x => x.partner === p);
    if (r) return { partner: p, status: r.status as PartnerCustomerStatus, note: r.note };
    return sandbox && p.startsWith("mock_") ? { partner: p, status: "APPROVED", note: "Sandbox partner" } : { partner: p, status: "NOT_STARTED", note: null };
  });
}

/** Live transfers need every partner on the route to have approved this customer. Starts onboarding for those that have not. */
export async function requireApprovedPartners(orgId: string, route: Route, sandbox: boolean): Promise<void> {
  if (sandbox) {
    // Record the (auto-approved) sandbox onboarding so the customer sees it; never blocks.
    for (const p of partnersOf(route)) await submitToPartner(orgId, p, true).catch(() => null);
    return;
  }
  const state = await onboardingFor(orgId, route, false);
  const pending: string[] = [];
  for (const s of state) {
    if (s.status === "APPROVED") continue;
    const row = await submitToPartner(orgId, s.partner, false);
    if (row.status !== "APPROVED") pending.push(`${s.partner} (${row.status.toLowerCase().replace("_", " ")})`);
  }
  if (pending.length) {
    const { ServiceError } = await import("@/lib/stablecoin/service");
    throw new ServiceError("PARTNER_ONBOARDING_PENDING", `The licensed partner has not yet approved your account for this route: ${pending.join(", ")}. Vaulte has sent your verified details; you will be notified when the partner decides.`, 409);
  }
}
