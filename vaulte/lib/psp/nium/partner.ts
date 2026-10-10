// Nium as a licensed partner: customer onboarding by API with decisions by webhook, a virtual account per customer and currency
// (funding details in the customer's name), and local-rail payouts (India: IMPS/NEFT/RTGS by IFSC).
// CUSTODY: money sits in the customer's own Nium wallet, never in a pooled Vaulte wallet. Nium's "prefund" feature (the client
// advancing its own money so customer credits are instant) is NOT used by this adapter and must stay off for a no-advance model.
import { timingSafeEqual } from "crypto";
import { majorString, majorToMinor } from "@/lib/currency";
import type { BeneficiaryDetails, CustomerPackage, DepositInstruction, FiatFundingInstruction, InfoAnswer, InfoRequest, PartnerCredit, PartnerCustomerResult, PartnerPayoutStatus, PayoutRequest, PayoutResult, StablecoinPartner, VirtualAccountRequest, VirtualAccountResult } from "@/lib/psp/stablecoin/partner";
import { PartnerError } from "../http";
import { NiumClient, parseNiumRef, type NiumCustomerV5, type NiumEntity } from "./client";
import { isResidentOf, niumCorporatePayload, niumInfoRequest, niumRegion, niumRfiResponseItem, type EnumLists } from "./onboarding";

const ENUM_CATEGORIES = ["businessType", "monthlyTransactionVolume", "monthlyTransactions", "averageTransactionValue", "intendedUseOfAccount", "totalEmployees", "annualTurnover", "industrySector"] as const;
const enumCache = new Map<string, { at: number; lists: EnumLists }>();

/**
 * Nium status / sub-status / compliance status -> Vaulte's four partner states. `clear` with a pending question is still approved; the question is
 * surfaced as a note. Pending with an RFI or an action required (v1/v2 `complianceStatus`) or awaiting KYC / an RFI (v5 `subStatus`) needs the customer.
 */
export function mapNiumStatus(status?: string | null, subStatus?: string | null, complianceStatus?: string | null): { status: PartnerCustomerResult["status"]; needsAction: boolean } {
  const s = (status ?? "").toLowerCase(), sub = (subStatus ?? "").toLowerCase(), cs = (complianceStatus ?? "").toUpperCase();
  const needsAction = sub === "awaiting_kyc" || sub === "rfi_requested" || cs === "RFI_REQUESTED" || cs === "ACTION_REQUIRED";
  if (s === "clear" || (s === "" && cs === "COMPLETED")) return { status: "APPROVED", needsAction };
  if (["rejected", "terminated", "closed", "suspended"].includes(s) || cs === "REJECTED") return { status: "REJECTED", needsAction: false };
  if (s === "pending" && needsAction) return { status: "NEEDS_INFO", needsAction };
  return { status: "SUBMITTED", needsAction: false };
}

/** Nium timestamps are UTC, written "YYYY-MM-DD HH:mm:ss" or as a date alone. */
const niumTime = (v: unknown) => { const t = String(v ?? ""); return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t.replace(" ", "T")}${t.includes(":") ? "" : "T00:00:00"}Z`); };

/** Nium's remittance statuses: INITIATED, IN_PROGRESS, COMPLIANCE_COMPLETED, SENT_TO_BANK, PAID, and the failures. */
export function mapNiumPayoutStatus(status: string, detail = ""): PartnerPayoutStatus {
  const s = status.toUpperCase();
  if (s === "PAID") return { state: "PAID" };
  if (["REJECTED", "RETURN", "RETURNED", "EXPIRED", "CANCELLED", "ERROR", "FAILED"].includes(s)) return { state: "FAILED", reason: `${s.toLowerCase()}${detail ? `: ${detail}` : ""}` };
  return { state: "PENDING" };
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

const entitiesOf = (c: NiumCustomerV5): NiumEntity[] => [c.applicant, ...(Array.isArray(c.stakeholders) ? c.stakeholders : c.stakeholders?.individual ?? [])].filter((e): e is NiumEntity => !!e);

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

  /**
   * The business registration document Nium asks for at creation (SG, UK, EU and others). Our verified document is uploaded and its fileId referenced.
   * Where the sandbox has no file route, NIUM_TEST_FILE_ID (a file id from the Nium portal) stands in so the rest of the flow can be tested; live never uses it.
   */
  private async withDocuments(pkg: CustomerPackage): Promise<CustomerPackage> {
    if (pkg.documents?.length) return pkg;
    const doc = pkg.documentFiles?.[0];
    if (doc) {
      try { return { ...pkg, documents: [{ type: "business_registration_doc", fileIds: [await this.client.uploadFile(await doc.load(), doc.filename, doc.mime)] }] }; }
      catch (e) { if (!(e instanceof PartnerError) || !this.client.isSandbox || !process.env.NIUM_TEST_FILE_ID) throw e; }
    }
    return this.client.isSandbox && process.env.NIUM_TEST_FILE_ID ? { ...pkg, documents: [{ type: "business_registration_doc", fileIds: [process.env.NIUM_TEST_FILE_ID] }] } : pkg;
  }

  async submitCustomer(rawPkg: CustomerPackage): Promise<PartnerCustomerResult> {
    let pkg = rawPkg;
    try { pkg = await this.withDocuments(rawPkg); }
    catch (e) { if (e instanceof PartnerError) return { partnerRef: "", status: "NEEDS_INFO", note: `Nium could not take the business document yet (${e.message.replace(/^Nium \S+ failed: /, "")}); Vaulte support will follow up` }; throw e; }
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
    const partnerRef = `${r.customerHashId}:${wallet}`;
    // KYC is a separate step per person (applicant and each stakeholder); without it the application never reaches Nium's review.
    const kyc = await this.startKyc(r as NiumCustomerV5, String(built.body.region), true);
    const m = mapNiumStatus(r.status, kyc.pending ? "awaiting_kyc" : r.subStatus);
    const note = [`Nium status: ${r.status}${r.subStatus ? ` / ${r.subStatus}` : ""}`, ...kyc.notes, ...(kyc.later ? ["Nium is still creating the customer; the identity check follows automatically"] : [])].join(". ");
    return { partnerRef, status: kyc.blocked ? "NEEDS_INFO" : m.status, note, ...(kyc.actionUrl ? { actionUrl: kyc.actionUrl } : r.redirectUrl ? { actionUrl: String(r.redirectUrl) } : {}) } as PartnerCustomerResult;
  }

  /**
   * Starts the identity check for the applicant and every individual stakeholder that still needs one. Vaulte keeps only masked ID numbers and
   * never sends documents on, so the check is Nium's own hosted liveness check against the person's government ID (biometric_kyc): the link is
   * returned as the customer's next step. Residents of the region where Nium does not offer it need their ID details sent by another route.
   * Nium creates the customer asynchronously ("under progress"): a call that is too early is retried briefly here and again by the status poll.
   */
  private async startKyc(r: NiumCustomerV5, region: string, patient = false): Promise<{ actionUrl?: string; notes: string[]; pending: boolean; blocked: boolean; later: boolean }> {
    const entities = entitiesOf(r);
    const out = { actionUrl: undefined as string | undefined, notes: [] as string[], pending: false, blocked: false, later: false };
    for (const e of entities) {
      if (e.kycStatus !== "kyc_required" || !e.referenceId) continue;
      const label = `${e.firstName ?? ""} ${e.lastName ?? ""}`.trim() || e.externalId || "a person";
      const body = { region, entityType: e === r.applicant ? "applicant" : "individual_stakeholder", isResident: isResidentOf(region, (e.address?.country ?? "").toUpperCase()), kycMode: "biometric_kyc", entityReferenceId: e.referenceId };
      for (let attempt = 0; ; attempt++) {
        try {
          const k = await this.client.submitKyc(r.customerHashId, body);
          out.pending = true;
          const url = k.biometricUrl ?? k.redirectUrl;
          if (url) { out.actionUrl ??= url; out.notes.push(`${label} must complete Nium's identity check`); }
          break;
        } catch (err) {
          if (!(err instanceof PartnerError) || err.status !== 400) throw err;
          if (/under progress|try again/i.test(err.message)) {
            if (patient && attempt < 5) { await new Promise(res => setTimeout(res, Number(process.env.NIUM_RETRY_MS ?? 1500) * (attempt + 1))); continue; }
            out.later = true; break; // Nium is still creating the customer: the status poll tries again
          }
          out.blocked = true; out.notes.push(`${label}: ${err.message.replace(/^Nium \S+ failed: /, "")}`); break;
        }
      }
    }
    return out;
  }

  async getCustomerStatus(partnerRef: string): Promise<PartnerCustomerResult> {
    const ref = parseNiumRef(partnerRef);
    try {
      let c = await this.client.customerV5(ref.customerHashId);
      // The identity check could not be started when the customer was created (Nium was still creating it): start it now.
      if (c.status === "pending" && entitiesOf(c).some(e => e.kycStatus === "kyc_required")) {
        const kyc = await this.startKyc(c, String(c.region ?? ""));
        if (kyc.pending) c = await this.client.customerV5(ref.customerHashId);
        else if (kyc.blocked) return { partnerRef, status: "NEEDS_INFO", note: kyc.notes.join(". ") };
      }
      const m = mapNiumStatus(c.status, c.subStatus);
      const waiting = entitiesOf(c).find(e => e.kycStatus === "initiated" && e.biometricUrl);
      const note = `Nium status: ${c.status}${c.subStatus ? ` / ${c.subStatus}` : ""}`;
      return { partnerRef, status: m.status, note: waiting ? `${note}. ${waiting.firstName ?? "A person"} must complete Nium's identity check` : note, ...(m.status === "NEEDS_INFO" && waiting?.biometricUrl ? { actionUrl: waiting.biometricUrl } : {}) };
    } catch (e) {
      // The v5 record is missing or briefly unavailable (customers created through other flows): fall back to the v1 record.
      if (!(e instanceof PartnerError)) throw e;
      const c = await this.client.getCustomer(ref.customerHashId);
      const m = mapNiumStatus(c.status, (c as { subStatus?: string }).subStatus, c.complianceStatus);
      return { partnerRef, status: m.status, note: `Nium status: ${c.status}${c.complianceStatus ? ` (${c.complianceStatus})` : ""}` };
    }
  }

  /** What Nium's compliance team has asked this customer for (open ones first). */
  async listInfoRequests(partnerRef: string): Promise<InfoRequest[]> {
    const r = await this.client.corporateRfis(parseNiumRef(partnerRef).customerHashId);
    return (r.rfiTemplates ?? []).map(niumInfoRequest).sort((a, b) => (a.status === b.status ? 0 : a.status === "OPEN" ? -1 : 1));
  }

  async answerInfoRequest(partnerRef: string, requestId: string, answer: InfoAnswer): Promise<void> {
    const customerHashId = parseNiumRef(partnerRef).customerHashId;
    const t = (await this.client.corporateRfis(customerHashId)).rfiTemplates?.find(x => x.rfiHashId === requestId);
    if (!t) throw new PartnerError(404, "NOT_FOUND", "That request is no longer open");
    if (t.status !== "RFI_REQUESTED") throw new PartnerError(409, "ALREADY_ANSWERED", "That request has already been answered");
    const region = String((await this.client.customerV5(customerHashId)).region ?? "");
    await this.client.respondCorporateRfi({ region, customerHashId, rfiResponseRequest: [niumRfiResponseItem(t, answer)] });
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

  /** Settled third-party credits on the customer's wallet (a payer wired money to the virtual account). */
  async listFundsReceived(customerRef: string, since: Date): Promise<PartnerCredit[]> {
    const ref = parseNiumRef(customerRef);
    const r = await this.client.transactions(ref);
    return (r.content ?? [])
      .filter(t => t.debit === false && /^Wallet_Credit/i.test(String(t.transactionType)) && t.status === "Approved" && t.settlementStatus === "Settled" && niumTime(t.createdAt ?? t.dateOfTransaction).getTime() >= since.getTime() - 5 * 60_000)
      .map(t => ({ id: String(t.authCode), currency: String(t.authCurrencyCode ?? t.transactionCurrencyCode), amountMinor: BigInt(majorToMinor(Number(t.authAmount), String(t.authCurrencyCode ?? t.transactionCurrencyCode))), senderName: t.labels?.remitterName ? String(t.labels.remitterName) : undefined, bankReference: t.labels?.bankReferenceNumber ? String(t.labels.bankReferenceNumber) : undefined, at: t.createdAt ? String(t.createdAt) : undefined }));
  }

  /** The payout's latest status from its audit trail (newest entry first) and the fee Nium charged for it. */
  async getPayoutStatus(partnerRef: string, customerRef?: string): Promise<PartnerPayoutStatus> {
    if (!customerRef) return { state: "PENDING" };
    const ref = parseNiumRef(customerRef);
    const a = await this.client.audit(ref, partnerRef);
    const list = (Array.isArray(a) ? a : (a as { content?: unknown[] }).content ?? [a]) as Record<string, unknown>[];
    const latest = [...list].sort((x, y) => String(y.lastUpdatedAt ?? "").localeCompare(String(x.lastUpdatedAt ?? "")))[0] ?? {};
    return mapNiumPayoutStatus(String(latest.status ?? ""), [latest.statusDetails, latest.errorDescription].filter(Boolean).join(": "));
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
    if ((template === "CUSTOMER_STATUS_WEBHOOK" || template === "CARD_CLIENT_KYB_STATUS_WEBHOOK") && p.customerHashId) {
      const m = mapNiumStatus(p.status, p.subStatus, p.complianceStatus);
      const note = `Nium status: ${p.status}${p.subStatus ? ` / ${p.subStatus}` : p.complianceStatus ? ` (${p.complianceStatus})` : ""}`;
      return { id: rid || `${template}:${p.customerHashId}:${p.status}:${p.subStatus ?? p.complianceStatus ?? ""}:${Date.now()}`, type: "customer.status", data: { customer_ref: String(p.customerHashId), state: m.status, note, resubmission_allowed: String(p.isResubmissionAllowed) === "true" } };
    }
    // One person's identity check moved: a failure or a link to complete it goes back to the customer as the next step.
    if (template === "CUSTOMER_ENTITY_KYC_STATUS" && p.customerHashId && (p.kycStatus === "failed" || (p.kycStatus === "initiated" && p.redirectUrl))) {
      return { id: rid || `${template}:${p.referenceId ?? p.customerHashId}:${p.kycStatus}`, type: "customer.status", data: { customer_ref: String(p.customerHashId), state: "NEEDS_INFO", note: p.kycStatus === "failed" ? "Identity check failed for one person; Nium needs their documents" : "A person must complete Nium's identity check", ...(p.redirectUrl ? { action_url: String(p.redirectUrl) } : {}) } };
    }
    // Payout events carry the payout's own reference; the id is derived from it (not from x-request-id) so a poll of the same payout is a duplicate, not a second event.
    if (template.startsWith("REMIT_TRANSACTION_") && p.systemReferenceNumber) {
      const srn = String(p.systemReferenceNumber);
      if (template === "REMIT_TRANSACTION_PAID_WEBHOOK") return { id: `payout:${srn}:paid`, type: "payout.completed", data: { transfer_ref: srn } };
      if (/_(REJECTED|RETURNED|CANCELLED|EXPIRED)_WEBHOOK$/.test(template)) return { id: `payout:${srn}:failed`, type: "payout.failed", data: { transfer_ref: srn, reason: template.replace(/^REMIT_TRANSACTION_|_WEBHOOK$/g, "").toLowerCase() } };
      return null; // initiated, sent to bank, delayed, awaiting funds: progress notes, nothing to act on
    }
    // The customer's wallet was credited (a payer wired money to its virtual account). Matched to a waiting transfer by customer, currency and amount.
    if (template === "CARD_WALLET_FUNDING_WEBHOOK" && p.customerHashId && p.authCode && p.transactionCurrency) {
      return { id: `funds:${p.authCode}`, type: "customer.funds_received", data: { customer_ref: String(p.customerHashId), currency: String(p.transactionCurrency), amount_minor: String(majorToMinor(Number(p.transactionAmount), String(p.transactionCurrency))), credit_id: String(p.authCode) } };
    }
    // Money arrived on a virtual account but Nium could not match it to a wallet: recorded for operations, never applied to a transfer.
    if (template === "INCOMING_FUNDS_WEBHOOK") return { id: rid || `${template}:${p.systemReferenceNumber ?? p.bankReferenceNumber}`, type: "funds.unmatched", data: { reference: String(p.bankReferenceNumber ?? ""), currency: String(p.transactionCurrency ?? ""), amount: String(p.transactionAmount ?? ""), remitter: String(p.remitterName ?? "") } };
    return null;
  }
}
