// Nium as a licensed partner: customer onboarding by API with decisions by webhook, a virtual account per customer and currency
// (funding details in the customer's name), and local-rail payouts (India: IMPS/NEFT/RTGS by IFSC).
// CUSTODY: money sits in the customer's own Nium wallet, never in a pooled Vaulte wallet. Nium's "prefund" feature (the client
// advancing its own money so customer credits are instant) is NOT used by this adapter and must stay off for a no-advance model.
import { timingSafeEqual } from "crypto";
import { majorString } from "@/lib/currency";
import type { BeneficiaryDetails, CustomerPackage, DepositInstruction, FiatFundingInstruction, PartnerCustomerResult, PayoutRequest, PayoutResult, StablecoinPartner, VirtualAccountRequest, VirtualAccountResult } from "@/lib/psp/stablecoin/partner";
import { PartnerError } from "../http";
import { NiumClient, parseNiumRef } from "./client";
import { niumCorporatePayload, niumRegion, type EnumLists } from "./onboarding";

const ENUM_CATEGORIES = ["monthlyTransactionVolume", "monthlyTransactions", "averageTransactionValue", "intendedUseOfAccount", "totalEmployees", "annualTurnover", "industrySector"] as const;
const enumCache = new Map<string, { at: number; lists: EnumLists }>();

/** Nium status/sub-status -> Vaulte's four partner states. `clear` with a pending question is still approved; the question is surfaced as a note. */
export function mapNiumStatus(status?: string | null, subStatus?: string | null): { status: PartnerCustomerResult["status"]; needsAction: boolean } {
  const s = (status ?? "").toLowerCase(), sub = (subStatus ?? "").toLowerCase();
  const needsAction = sub === "awaiting_kyc" || sub === "rfi_requested";
  if (s === "clear") return { status: "APPROVED", needsAction };
  if (s === "rejected" || s === "terminated" || s === "closed" || s === "suspended") return { status: "REJECTED", needsAction: false };
  if (s === "pending" && needsAction) return { status: "NEEDS_INFO", needsAction };
  return { status: "SUBMITTED", needsAction: false };
}

export function niumBeneficiary(b: BeneficiaryDetails): Record<string, unknown> {
  const routing: { type: string; value: string }[] = [];
  let accountNumber = b.accountNumber ?? b.iban ?? "";
  if (b.ifsc) routing.push({ type: "IFSC", value: b.ifsc });
  if (b.routingNumber) routing.push({ type: "ACH CODE", value: b.routingNumber });
  if (b.sortCode) routing.push({ type: "SORT CODE", value: b.sortCode.replace(/-/g, "") });
  if (b.swiftBic) routing.push({ type: "SWIFT", value: b.swiftBic });
  if (!accountNumber) throw new Error("RECIPIENT_BANK_DETAILS_MISSING: Nium needs the recipient's account number or IBAN");
  const method = b.ifsc || b.routingNumber || b.sortCode || (b.iban && !b.swiftBic) ? "LOCAL" : "SWIFT";
  return {
    beneficiary: { name: b.accountName, accountType: b.entityType === "COMPANY" ? "CORPORATE" : "INDIVIDUAL", countryCode: b.bankCountry },
    paymentAccount: { accountNumber, payoutMethod: method, payoutCurrency: b.currency, routingCode: routing },
  };
}

export class NiumPartner implements StablecoinPartner {
  readonly id = "nium";
  constructor(private client: NiumClient, private webhookKey = process.env.NIUM_WEBHOOK_KEY) {}

  private async enums(region: string): Promise<EnumLists> {
    const hit = enumCache.get(region);
    if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.lists;
    const lists: EnumLists = {};
    await Promise.all(ENUM_CATEGORIES.map(async c => { try { lists[c] = (await this.client.constants(c, region)).data; } catch { /* a missing list leaves that field out and Nium reports it */ } }));
    enumCache.set(region, { at: Date.now(), lists });
    return lists;
  }

  async createDeposit(): Promise<DepositInstruction> { throw new Error("Nium does not accept stablecoin deposits in this integration"); }

  async submitCustomer(pkg: CustomerPackage): Promise<PartnerCustomerResult> {
    const built = niumCorporatePayload(pkg, await this.enums(niumRegion(pkg.country)));
    if (!built.body) return { partnerRef: "", status: "NEEDS_INFO", note: `Nium needs: ${built.missing.join("; ")}` };
    let r;
    try { r = await this.client.createCustomer(built.body); }
    catch (e) {
      // A validation failure is something the customer or we can fix: report it as a missing item instead of an outage.
      if (e instanceof PartnerError && (e.status === 400 || e.status === 422)) return { partnerRef: "", status: "NEEDS_INFO", note: e.message.replace(/^Nium \S+ failed: /, "Nium says: ") };
      throw e;
    }
    const wallet = r.walletHashId ?? (r as { wallets?: { walletHashId: string }[] }).wallets?.[0]?.walletHashId ?? "";
    const m = mapNiumStatus(r.status, r.subStatus);
    return { partnerRef: `${r.customerHashId}:${wallet}`, status: m.status, note: `Nium status: ${r.status}${r.subStatus ? ` / ${r.subStatus}` : ""}`, ...(r.redirectUrl ? { actionUrl: String(r.redirectUrl) } : {}) } as PartnerCustomerResult;
  }

  async getCustomerStatus(partnerRef: string): Promise<PartnerCustomerResult> {
    const ref = parseNiumRef(partnerRef);
    const c = await this.client.getCustomer(ref.customerHashId);
    const m = mapNiumStatus(c.status, (c as { subStatus?: string }).subStatus);
    return { partnerRef, status: m.status, note: `Nium status: ${c.status}${c.complianceStatus ? ` (${c.complianceStatus})` : ""}` };
  }

  /** The customer's own account details for one currency; assigned on first use from the bank sources configured for the client. */
  private async vanFor(customerRef: string | undefined, currency: string) {
    if (!customerRef) throw new Error("Nium needs the customer's own account: onboard the customer first");
    const ref = parseNiumRef(customerRef);
    let van = (await this.client.paymentIds(ref)).find(p => p.currencyCode === currency);
    if (!van) {
      const source = ((await this.client.client()).paymentIds ?? []).find((p: Record<string, string>) => p.currencyCode === currency);
      if (!source?.bankName) throw new Error(`Nium has no bank source configured for ${currency} on this client account`);
      await this.client.assignPaymentId(ref, currency, source.bankName);
      van = (await this.client.paymentIds(ref)).find(p => p.currencyCode === currency);
    }
    if (!van?.uniquePaymentId) throw new Error(`Nium did not return an account for ${currency}`);
    return van;
  }

  private details(van: Awaited<ReturnType<NiumPartner["vanFor"]>>, holder: string, currency: string, extra: Record<string, string> = {}): Record<string, string> {
    const o: Record<string, string | undefined> = { account_holder: holder, account_number: van.uniquePaymentId, [(van.routingCodeType1 ?? "routing_code").toLowerCase().replace(/[^a-z0-9]+/g, "_")]: van.routingCodeValue1, [(van.routingCodeType2 ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_")]: van.routingCodeValue2, bank_name: van.bankNameFull ?? van.bankName, currency, ...extra };
    return Object.fromEntries(Object.entries(o).filter(([k, v]) => k && typeof v === "string" && v)) as Record<string, string>;
  }

  async createFiatFunding(o: { transferId: string; currency: string; amountMinor: bigint; customerRef?: string }): Promise<FiatFundingInstruction> {
    const van = await this.vanFor(o.customerRef, o.currency);
    return { partnerRef: van.uniquePaymentId!, reference: o.transferId, bankDetails: this.details(van, van.accountName ?? "", o.currency, { reference: o.transferId }) };
  }

  async createVirtualAccount(r: VirtualAccountRequest): Promise<VirtualAccountResult> {
    const van = await this.vanFor(r.customerRef, r.currency);
    return { partnerRef: van.uniquePaymentId!, details: this.details(van, van.accountName ?? r.legalName, r.currency, { country: r.country }) };
  }

  async createPayout(req: PayoutRequest): Promise<PayoutResult> {
    if (!req.beneficiary) throw new Error("RECIPIENT_BANK_DETAILS_MISSING: add the recipient's bank account before paying out via Nium");
    if (!req.customerRef) throw new Error("Nium pays from the customer's own wallet: onboard the customer first");
    const leg = req.route.legs[req.route.legs.length - 1];
    const ref = parseNiumRef(req.customerRef);
    const dest = Number(majorString(req.destAmountMinor, req.destCurrency));
    const r = await this.client.remit(ref, {
      beneficiary: niumBeneficiary(req.beneficiary),
      payout: { ...(leg.srcCurrency ? { sourceCurrency: leg.srcCurrency } : {}), destinationAmount: dest },
      purposeCode: process.env.NIUM_PURPOSE_CODE ?? "IR001",
      sourceOfFunds: process.env.NIUM_SOURCE_OF_FUNDS ?? "Corporate Account",
      ...(req.invoiceNumber ? { customerReference: req.invoiceNumber.slice(0, 35) } : {}),
      externalId: req.transferId.slice(0, 36),
    });
    if (!r.system_reference_number) throw new Error(`Nium did not accept the payout: ${r.message ?? "no reference returned"}`);
    return { partnerRef: r.system_reference_number };
  }

  /** Nium can add a static `x-partner-key` header to every webhook; that shared secret is the authentication. */
  verifyWebhook(_raw: string, headers: Headers): boolean {
    const given = headers.get("x-partner-key") ?? "";
    if (!this.webhookKey || !given) return false;
    const a = Buffer.from(given), b = Buffer.from(this.webhookKey);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  normalizeWebhook(payload: unknown, headers?: Headers) {
    const p = payload as Record<string, any>;
    const template = String(p?.template ?? "");
    const rid = headers?.get("x-request-id") ?? "";
    if (template === "CUSTOMER_STATUS_WEBHOOK" && p.customerHashId) {
      return { id: rid || `${template}:${p.customerHashId}:${p.status}:${p.subStatus ?? ""}:${Date.now()}`, type: "customer.status", data: { customer_ref: String(p.customerHashId), state: mapNiumStatus(p.status, p.subStatus).status, note: `Nium status: ${p.status}${p.subStatus ? ` / ${p.subStatus}` : ""}`, resubmission_allowed: String(p.isResubmissionAllowed) === "true" } };
    }
    if (template.startsWith("REMIT_TRANSACTION_") && p.systemReferenceNumber) {
      const id = rid || `${template}:${p.systemReferenceNumber}`;
      if (template === "REMIT_TRANSACTION_PAID_WEBHOOK") return { id, type: "payout.completed", data: { transfer_ref: String(p.systemReferenceNumber) } };
      if (/_(REJECTED|RETURNED|CANCELLED|EXPIRED)_WEBHOOK$/.test(template)) return { id, type: "payout.failed", data: { transfer_ref: String(p.systemReferenceNumber), reason: template.replace(/^REMIT_TRANSACTION_|_WEBHOOK$/g, "").toLowerCase() } };
    }
    return null;
  }
}
