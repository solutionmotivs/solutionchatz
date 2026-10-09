// Delegated onboarding: Vaulte runs KYC/KYB and sends the approved package to the licensed partner, which is the provider of record and decides.
// Live money moves through a partner only when the customer is APPROVED there. Test mode uses sandbox partners that auto-approve so the flow is visible.
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { getPartner } from "@/lib/psp/stablecoin/registry";
import type { PackagePerson, CustomerPackage, PartnerCustomerResult } from "@/lib/psp/stablecoin/partner";
import type { Route } from "@/lib/stablecoin/types";

export const PARTNER_STATUSES = ["INVITED", "SUBMITTED", "NEEDS_INFO", "APPROVED", "REJECTED"] as const;
export type PartnerCustomerStatus = (typeof PARTNER_STATUSES)[number];

export const partnersOf = (route: Route) => Array.from(new Set(route.legs.map(l => l.partner)));

async function packageFor(orgId: string): Promise<CustomerPackage> {
  const o = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  const kyb = await db.verificationCase.findFirst({ where: { organizationId: orgId, subjectType: "ORGANIZATION", status: "APPROVED" }, orderBy: { decidedAt: "desc" }, select: { profile: true, people: true } });
  const prof = (kyb?.profile ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof prof[k] === "string" && (prof[k] as string).trim() ? (prof[k] as string).trim() : null);
  const owner = await db.user.findFirst({ where: { organizationId: orgId, role: "OWNER" }, orderBy: { createdAt: "asc" }, select: { name: true, email: true, phone: true } });
  const [first, ...rest] = (owner?.name ?? "").trim().split(/\s+/);
  const address = str("address");
  const parts = address?.split(",").map(x => x.trim()).filter(Boolean) ?? [];
  return {
    organizationId: o.id, legalName: o.legalName ?? o.name, country: o.country ?? "", registrationNumber: o.registrationNumber, taxId: o.taxId, businessType: o.businessType, riskTier: o.riskTier, kybApprovedAt: o.kybApprovedAt?.toISOString() ?? null,
    address, city: str("city") ?? (parts.length > 1 ? parts[parts.length - 1] : null), postalCode: str("postal_code"), state: str("state"),
    incorporationDate: o.incorporationDate?.toISOString() ?? str("incorporation_date"), industry: str("industry"), website: o.website ?? str("website"),
    expectedMonthlyUsd: typeof prof.expected_monthly_usd === "number" ? prof.expected_monthly_usd : null,
    people: (kyb?.people ?? []).map(p => {
      const [first, ...rest] = p.fullName.trim().split(/\s+/);
      const c = (p.contact ?? {}) as { email?: string; phone?: string; phone_country_code?: string; address?: PackagePerson["address"] };
      return { role: p.role as PackagePerson["role"], firstName: first, lastName: rest.join(" ") || first, dateOfBirth: p.dateOfBirth, nationality: p.nationality, ownershipPct: p.ownershipPct, email: c.email ?? null, phone: c.phone ?? null, phoneCountryCode: c.phone_country_code ?? null, address: c.address ?? null };
    }),
    contact: owner ? { firstName: first || "Account", lastName: rest.join(" ") || "Owner", email: owner.email, phone: owner.phone ?? null } : undefined,
  };
}

/** The customer's own account reference at a partner, if the partner has approved them (used so money moves from their sub-account, never a pooled one). */
export async function customerRefFor(orgId: string, partnerId: string, sandbox: boolean): Promise<string | undefined> {
  const r = await db.partnerCustomer.findUnique({ where: { organizationId_partner_sandbox: { organizationId: orgId, partner: partnerId, sandbox } }, select: { status: true, partnerRef: true } });
  return r?.status === "APPROVED" && r.partnerRef ? r.partnerRef : undefined;
}

function apply(res: PartnerCustomerResult) {
  const decided = res.status === "APPROVED" || res.status === "REJECTED";
  return { partnerRef: res.partnerRef || null, status: res.status, note: res.note ?? null, actionUrl: res.actionUrl ?? null, ...(decided ? { decidedAt: new Date() } : {}) };
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

/** A partner's webhook says a customer's onboarding status changed. The customer is never contacted by Vaulte separately: the dashboard shows the new state and the exact next step. */
export async function applyCustomerStatusEvent(partnerId: string, d: { customer_ref: string; state: string; note?: string; action_url?: string }): Promise<boolean> {
  const states = ["SUBMITTED", "NEEDS_INFO", "APPROVED", "REJECTED"];
  if (!states.includes(d.state)) return false;
  const rows = await db.partnerCustomer.findMany({ where: { partner: partnerId, partnerRef: { startsWith: d.customer_ref } } });
  if (!rows.length) return false;
  const decided = d.state === "APPROVED" || d.state === "REJECTED";
  for (const r of rows) {
    await db.partnerCustomer.update({ where: { id: r.id }, data: { status: d.state, note: d.note ?? r.note, actionUrl: d.state === "NEEDS_INFO" ? (d.action_url ?? r.actionUrl) : null, ...(decided ? { decidedAt: new Date() } : {}) } });
    await db.auditLog.create({ data: { organizationId: r.organizationId, action: "partner_customer.status_event", resourceType: "PartnerCustomer", resourceId: r.id, metadata: { partner: partnerId, from: r.status, to: d.state } } });
  }
  return true;
}
