// Delegated onboarding: Vaulte runs KYC/KYB and sends the approved package to the licensed partner, which is the provider of record and decides.
// Live money moves through a partner only when the customer is APPROVED there. Test mode uses sandbox partners that auto-approve so the flow is visible.
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { decryptString } from "@/lib/security/crypto";
import { loadDecrypted } from "@/lib/storage";
import { getPartner } from "@/lib/psp/stablecoin/registry";
import type { PackagePerson, CustomerPackage, PartnerCustomerResult } from "@/lib/psp/stablecoin/partner";
import type { Route } from "@/lib/stablecoin/types";

export const PARTNER_STATUSES = ["INVITED", "SUBMITTED", "NEEDS_INFO", "APPROVED", "REJECTED"] as const;
export type PartnerCustomerStatus = (typeof PARTNER_STATUSES)[number];

export const partnersOf = (route: Route) => Array.from(new Set(route.legs.map(l => l.partner)));

/** Verified business documents a partner may ask for, best first. */
const BUSINESS_DOC_PRIORITY = ["CERT_OF_INCORPORATION", "REGISTRY_EXTRACT", "TRADE_LICENCE_COPY", "GST_CERTIFICATE", "IEC_CERTIFICATE"];

const EURO = new Set(["AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SI", "SK"]);

/** Bank names by the first four letters of an IFSC code (partners ask for the bank's name, which the KYB form does not collect). */
const IFSC_BANKS: Record<string, string> = { HDFC: "HDFC Bank", ICIC: "ICICI Bank", SBIN: "State Bank of India", UTIB: "Axis Bank", KKBK: "Kotak Mahindra Bank", PUNB: "Punjab National Bank", BARB: "Bank of Baroda", CNRB: "Canara Bank", IDIB: "Indian Bank", YESB: "Yes Bank", INDB: "IndusInd Bank", IDFB: "IDFC First Bank", UBIN: "Union Bank of India", BKID: "Bank of India", FDRL: "Federal Bank", RATN: "RBL Bank" };

/** The business bank account from the KYB form ("IFSC|account", "routing|account", "BSB|account", an IBAN or "BIC|account") as the account partners return funds to. */
export function returnBankFrom(country: string, value: string, accountName: string): CustomerPackage["returnBank"] | undefined {
  const raw = value.trim(), c = country.toUpperCase();
  const [a, b] = raw.split("|").map(x => x.trim());
  if (c === "IN" && a && b) return { accountName, accountNumber: b, bankCountry: "IN", currency: "INR", routingType: "IFSC", routingValue: a.toUpperCase(), bankName: IFSC_BANKS[a.slice(0, 4).toUpperCase()] ?? `Bank ${a.slice(0, 4).toUpperCase()}` };
  if (c === "US" && a && b) return { accountName, accountNumber: b, bankCountry: "US", currency: "USD", routingType: "ACH CODE", routingValue: a, bankName: `US bank (routing ${a})` };
  if (c === "AU" && a && b) return { accountName, accountNumber: b, bankCountry: "AU", currency: "AUD", routingType: "BSB", routingValue: a.replace("-", ""), bankName: `AU bank (BSB ${a.replace("-", "")})` };
  if (!b && /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(raw.replace(/\s/g, "").toUpperCase())) return { accountName, accountNumber: raw.replace(/\s/g, "").toUpperCase(), bankCountry: c, currency: c === "GB" ? "GBP" : EURO.has(c) ? "EUR" : "USD", routingType: "", routingValue: "", bankName: `${c} bank (IBAN ${raw.replace(/\s/g, "").slice(4, 8).toUpperCase()})` };
  if (a && b) return { accountName, accountNumber: b, bankCountry: c, currency: "USD", routingType: "SWIFT", routingValue: a.toUpperCase(), bankName: `Bank ${a.toUpperCase()}` };
  return undefined;
}

async function packageFor(orgId: string): Promise<CustomerPackage> {
  const o = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  const kyb = await db.verificationCase.findFirst({ where: { organizationId: orgId, subjectType: "ORGANIZATION", status: "APPROVED" }, orderBy: { decidedAt: "desc" }, select: { profile: true, people: true, items: { where: { code: "BANK_ACCOUNT" }, select: { valueEnc: true } }, documents: { where: { personId: null, status: { not: "REJECTED" }, type: { in: BUSINESS_DOC_PRIORITY } }, select: { type: true, filename: true, mime: true, storageKey: true } } } });
  const prof = (kyb?.profile ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof prof[k] === "string" && (prof[k] as string).trim() ? (prof[k] as string).trim() : null);
  const owner = await db.user.findFirst({ where: { organizationId: orgId, role: "OWNER" }, orderBy: { createdAt: "asc" }, select: { name: true, email: true, phone: true, termsAcceptedAt: true } });
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
    returnBank: kyb?.items?.[0] ? returnBankFrom(o.country ?? "", decryptString(kyb.items[0].valueEnc), o.legalName ?? o.name) : undefined,
    consent: owner?.termsAcceptedAt ? { acceptedAt: owner.termsAcceptedAt.toISOString(), deviceInfo: "web", sessionId: `vaulte-${o.id}`.slice(0, 40) } : undefined,
    documentFiles: [...(kyb?.documents ?? [])].sort((a, b) => BUSINESS_DOC_PRIORITY.indexOf(a.type) - BUSINESS_DOC_PRIORITY.indexOf(b.type)).map(d => ({ kind: d.type, filename: d.filename, mime: d.mime, load: () => loadDecrypted(d.storageKey) })),
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
  // Once the partner has the customer (a reference exists) it is never created again: the partner may be waiting for the customer, not for us.
  if (existing && (existing.partnerRef || (existing.status !== "INVITED" && existing.status !== "NEEDS_INFO"))) return existing;
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

/** Refresh SUBMITTED and NEEDS_INFO customers (a webhook may have been missed) from partners that expose a status call. Run by the scheduler. */
export async function refreshPartnerCustomers(): Promise<{ checked: number; changed: number }> {
  const rows = await db.partnerCustomer.findMany({ where: { status: { in: ["SUBMITTED", "NEEDS_INFO"] }, partnerRef: { not: null } }, orderBy: { updatedAt: "asc" }, take: 200 });
  let changed = 0;
  for (const r of rows) {
    try {
      const adapter = getPartner(r.partner);
      if (!adapter.getCustomerStatus) continue;
      const res = await adapter.getCustomerStatus(r.partnerRef!);
      if (res.status !== r.status || (res.note ?? null) !== r.note || (res.status === "NEEDS_INFO" && (res.actionUrl ?? null) !== r.actionUrl)) { await db.partnerCustomer.update({ where: { id: r.id }, data: apply(res) }); changed++; }
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
  const pending: string[] = [];
  for (const s of await onboardingFor(orgId, route, sandbox)) {
    // Test partners that approve at once are recorded so the customer sees them, and never block. A real partner's sandbox decides like the live one.
    if (sandbox && s.partner.startsWith("mock_")) { await submitToPartner(orgId, s.partner, true).catch(() => null); continue; }
    if (s.status === "APPROVED") continue;
    const row = await submitToPartner(orgId, s.partner, sandbox);
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
