import { majorString } from "@/lib/currency";
// Currencycloud as a payout/funding partner. CUSTODY: payments are made from balances at Currencycloud. Fund them only through
// sub-accounts / on-behalf-of contacts held in the customer's own name (CURRENCYCLOUD_ON_BEHALF_OF), never from one pooled Vaulte account.
import { timingSafeEqual } from "crypto";
import type { BeneficiaryDetails, CustomerPackage, DepositInstruction, FiatFundingInstruction, PartnerCustomerResult, PayoutRequest, PayoutResult, StablecoinPartner, VirtualAccountRequest, VirtualAccountResult } from "@/lib/psp/stablecoin/partner";
import { CurrencycloudClient, parseCustomerRef, uniqueId } from "./client";

export function ccBeneficiary(b: BeneficiaryDetails): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {
    bank_account_holder_name: b.accountName, name: b.accountName, bank_country: b.bankCountry, beneficiary_country: b.bankCountry, currency: b.currency,
    beneficiary_entity_type: b.entityType === "COMPANY" ? "company" : "individual", beneficiary_address: "-", ...(b.entityType === "COMPANY" ? { beneficiary_company_name: b.accountName } : {}),
  };
  if (b.iban) out.iban = b.iban;
  if (b.swiftBic) out.bic_swift = b.swiftBic;
  if (b.accountNumber) out.account_number = b.accountNumber;
  if (b.routingNumber) { out.routing_code_type_1 = "aba"; out.routing_code_value_1 = b.routingNumber; }
  else if (b.sortCode) { out.routing_code_type_1 = "sort_code"; out.routing_code_value_1 = b.sortCode.replace(/-/g, ""); }
  return out;
}

const SUB_TYPE: Record<string, string> = { "private limited": "limited_liability_company", "public limited": "public_limited_company", llp: "limited_liability_partnership", partnership: "unincorporated_partnership", "sole proprietorship": "sole_trader" };

/** What Currencycloud needs to open a customer's sub-account, or null with the list of what is missing. */
export function ccAccountFromPackage(p: CustomerPackage): { params: Record<string, string | number | string[]>; missing: string[] } {
  const missing: string[] = [];
  const need = (v: unknown, label: string) => { if (!v) missing.push(label); return v as string; };
  const id = p.registrationNumber ?? p.taxId;
  const params: Record<string, string | number | string[]> = {
    account_name: p.legalName, legal_entity_type: "company", legal_entity_sub_type: SUB_TYPE[(p.businessType ?? "").toLowerCase()] ?? "limited_liability_company", status: "enabled",
    street: need(p.address, "registered address"), city: need(p.city, "city"), country: p.country, postal_code: p.postalCode ?? "-",
    trading_address_street: p.address ?? "", trading_address_city: p.city ?? "", trading_address_country: p.country,
    identification_type: "incorporation_number", identification_value: need(id, "registration number"),
    country_of_incorporation: p.country, date_of_incorporation: need(p.incorporationDate?.slice(0, 10), "incorporation date"),
    industry_type: (p.industry ?? "other").toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60) || "other", business_website_url: p.website ?? "https://vaulte.iaexnetwork.com",
    expected_monthly_activity_volume: 20, expected_monthly_activity_value: Math.max(1, Math.round(p.expectedMonthlyUsd ?? 10_000)),
    expected_transaction_currencies: ["USD"], expected_transaction_countries: [p.country],
    customer_risk: p.riskTier === "HIGH" ? "HIGH" : p.riskTier === "LOW" ? "LOW" : "MEDIUM", your_reference: p.organizationId,
  };
  return { params, missing };
}

export class CurrencycloudPartner implements StablecoinPartner {
  readonly id = "currencycloud";
  constructor(private client: CurrencycloudClient, private webhookSecret = process.env.CURRENCYCLOUD_WEBHOOK_SECRET) {}

  async createDeposit(): Promise<DepositInstruction> { throw new Error("Currencycloud does not accept stablecoin deposits in this integration"); }

  /** A customer's own sub-account (created at onboarding) with its own funding details in the customer's name. */
  async submitCustomer(pkg: CustomerPackage): Promise<PartnerCustomerResult> {
    const { params, missing } = ccAccountFromPackage(pkg);
    if (missing.length) return { partnerRef: "", status: "NEEDS_INFO", note: `Currencycloud needs: ${missing.join(", ")}` };
    const acct = await this.client.createAccount({ ...params, unique_request_id: undefined });
    const c = pkg.contact;
    if (!c) return { partnerRef: acct.id, status: "SUBMITTED", note: "Sub-account created; add an account contact to trade" };
    const contact = await this.client.createContact({ account_id: acct.id, first_name: c.firstName, last_name: c.lastName, email_address: c.email, phone_number: c.phone ?? undefined, your_reference: pkg.organizationId, status: "enabled" });
    return { partnerRef: `${acct.id}:${contact.id}`, status: acct.status === "enabled" ? "APPROVED" : "SUBMITTED", note: acct.short_reference ? `Currencycloud account ${acct.short_reference}` : undefined };
  }

  async getCustomerStatus(partnerRef: string): Promise<PartnerCustomerResult> {
    const a = await this.client.getAccount(parseCustomerRef(partnerRef).accountId);
    const st = (a.status ?? "").toLowerCase();
    return { partnerRef, status: st === "enabled" ? "APPROVED" : st === "closed" || st === "disabled" ? "REJECTED" : "SUBMITTED", note: st ? `Currencycloud status: ${st}` : undefined };
  }

  async createFiatFunding(o: { transferId: string; currency: string; amountMinor: bigint; customerRef?: string }): Promise<FiatFundingInstruction> {
    const f = (await this.client.forCustomer(o.customerRef).fundingAccount(o.currency)).funding_accounts?.[0];
    if (!f) throw new Error(`No Currencycloud funding account for ${o.currency}`);
    return { partnerRef: f.id ?? o.transferId, reference: o.transferId, bankDetails: Object.fromEntries(Object.entries({ account_name: f.account_holder_name, account_number: f.account_number, [f.routing_code_type ?? "routing_code"]: f.routing_code, bank_name: f.bank_name, currency: o.currency, reference: o.transferId }).filter(([, v]) => typeof v === "string" && v) as [string, string][]) };
  }

  async createPayout(req: PayoutRequest): Promise<PayoutResult> {
    if (!req.beneficiary) throw new Error("RECIPIENT_BANK_DETAILS_MISSING: add the recipient's bank account before paying out via Currencycloud");
    const leg = req.route.legs[req.route.legs.length - 1];
    const dest = majorString(req.destAmountMinor, req.destCurrency);
    const cl = this.client.forCustomer(req.customerRef);
    const ben = await cl.createBeneficiary({ ...ccBeneficiary(req.beneficiary) });
    // The rate is not lockable: we fix the BUY side so the recipient gets exactly the quoted amount; any rate drift is Vaulte's margin.
    let conversionId: string | undefined;
    if (leg.srcCurrency && leg.srcCurrency !== req.destCurrency) {
      conversionId = (await cl.createConversion({ requestId: uniqueId("conv", req.transferId), sellCurrency: leg.srcCurrency, buyCurrency: req.destCurrency, buyAmount: dest, reason: "Payment for goods or services" })).id;
    }
    const p = await cl.createPayment({ requestId: uniqueId("pay", req.transferId), currency: req.destCurrency, beneficiaryId: ben.id, amount: dest, reason: req.purposeCode ? "Payment for goods or services" : "Family support", reference: (req.invoiceNumber ?? req.transferId).slice(0, 35), conversionId, priority: leg.rails[0] === "SWIFT" });
    return { partnerRef: p.id };
  }

  async createVirtualAccount(r: VirtualAccountRequest): Promise<VirtualAccountResult> {
    const f = (await this.client.forCustomer(r.customerRef).fundingAccount(r.currency)).funding_accounts?.[0];
    if (!f) throw new Error(`No Currencycloud funding account for ${r.currency}`);
    return { partnerRef: f.id ?? uniqueId("va", r.entityId, r.currency), details: Object.fromEntries(Object.entries({ account_holder: f.account_holder_name ?? r.legalName, currency: r.currency, country: r.country, account_number: f.account_number, [f.routing_code_type ?? "routing_code"]: f.routing_code, bank_name: f.bank_name }).filter(([, v]) => typeof v === "string" && v) as [string, string][]) };
  }

  /** Currencycloud notification callbacks cannot carry custom headers, so authenticate with a secret in the callback URL (?s=...). */
  verifyWebhook(_raw: string, headers: Headers, url?: URL): boolean {
    const given = url?.searchParams.get("s") ?? headers.get("x-notification-secret") ?? "";
    if (!this.webhookSecret || !given) return false;
    const a = Buffer.from(given), b = Buffer.from(this.webhookSecret);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  normalizeWebhook(payload: unknown) {
    const p = payload as { message_type?: string; id?: string; body?: Record<string, any>; data?: Record<string, any>; header?: { message_id?: string } };
    const d = p?.body ?? p?.data;
    const kind = String(p?.message_type ?? "");
    if (!d?.id || !kind.includes("payment")) return null;
    const status = String(d.status ?? d.payment_status ?? "").toLowerCase();
    const id = p.header?.message_id ?? p.id ?? `${d.id}:${status}`;
    if (["completed", "released", "paid"].includes(status)) return { id, type: "payout.completed", data: { transfer_ref: d.id } };
    if (["failed", "cancelled", "returned", "rejected"].includes(status)) return { id, type: "payout.failed", data: { transfer_ref: d.id, reason: String(d.failure_reason ?? d.failure_returned_reason ?? status) } };
    return null;
  }
}
