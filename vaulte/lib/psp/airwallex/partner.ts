// Airwallex as a payout/funding partner for non-India corridors (no INR: Airwallex is not an RBI-authorised PA-CB).
//
// CUSTODY WARNING: Airwallex pays out from a wallet balance. If Vaulte funds that wallet from one Vaulte-owned account,
// Vaulte is holding customer money in transit, which the "no custody" model forbids and which usually needs a licence.
// Use Airwallex connected accounts (AIRWALLEX_ON_BEHALF_OF per customer, requires a platform agreement) so each
// customer's funds sit in their own Airwallex account.
import { createHmac, timingSafeEqual } from "crypto";
import type {
  BeneficiaryDetails, DepositInstruction, FiatFundingInstruction, PayoutRequest, PayoutResult, StablecoinPartner, VirtualAccountRequest, VirtualAccountResult,
} from "@/lib/psp/stablecoin/partner";
import { AirwallexClient, requestId, type BankDetails } from "./client";

const REASON_BY_PURPOSE = (purposeCode?: string | null) => (purposeCode ? "professional_business_services" : "personal_remittance");

export function bankDetailsFor(b: BeneficiaryDetails): { bank: BankDetails; method: "LOCAL" | "SWIFT" } {
  const bank: BankDetails = { account_name: b.accountName, account_currency: b.currency, bank_country_code: b.bankCountry, bank_name: b.bankName };
  if (b.iban) bank.iban = b.iban;
  if (b.accountNumber) bank.account_number = b.accountNumber;
  if (b.swiftBic) bank.swift_code = b.swiftBic;
  if (b.routingNumber) { bank.account_routing_type1 = "aba"; bank.account_routing_value1 = b.routingNumber; }
  else if (b.sortCode) { bank.account_routing_type1 = "sort_code"; bank.account_routing_value1 = b.sortCode.replace(/-/g, ""); }
  return { bank, method: "LOCAL" };
}

export class AirwallexPartner implements StablecoinPartner {
  readonly id = "airwallex";
  constructor(private client: AirwallexClient, private webhookSecret: string | undefined = process.env.AIRWALLEX_WEBHOOK_SECRET) {}

  async createDeposit(): Promise<DepositInstruction> {
    throw new Error("Airwallex does not accept stablecoin deposits in this integration");
  }

  async createFiatFunding(opts: { transferId: string; currency: string; amountMinor: bigint }): Promise<FiatFundingInstruction> {
    const acct = await this.client.createGlobalAccount({ requestId: requestId("fund", opts.transferId), countryCode: countryForCurrency(opts.currency), currency: opts.currency, nickname: `vaulte-${opts.transferId.slice(-8)}` });
    return {
      partnerRef: acct.id ?? requestId("fund", opts.transferId),
      reference: opts.transferId,
      bankDetails: Object.fromEntries(Object.entries({
        account_name: acct.account_name, account_number: acct.account_number, iban: acct.iban, swift_code: acct.swift_code, bank_name: acct.institution?.name,
        currency: opts.currency, reference: opts.transferId,
      }).filter(([, v]) => typeof v === "string" && v) as [string, string][]),
    };
  }

  async createPayout(req: PayoutRequest): Promise<PayoutResult> {
    const leg = req.route.legs[req.route.legs.length - 1];
    if (!req.beneficiary) throw new Error("RECIPIENT_BANK_DETAILS_MISSING: add the recipient's bank account before paying out via Airwallex");
    const sourceCurrency = leg.srcCurrency ?? req.destCurrency;
    const { bank } = bankDetailsFor(req.beneficiary);
    const method: "LOCAL" | "SWIFT" = leg.rails[0] === "SWIFT" ? "SWIFT" : "LOCAL";
    const ben = await this.client.createBeneficiary({
      requestId: requestId("beneficiary", req.transferId), entityType: req.beneficiary.entityType, name: req.beneficiary.accountName, bank, methods: [method],
    });
    const beneficiaryId = ben.id ?? ben.beneficiary_id;
    if (!beneficiaryId) throw new Error("Airwallex did not return a beneficiary id");
    const tr = await this.client.createTransfer({
      requestId: requestId("transfer", req.transferId), beneficiaryId, sourceCurrency, transferCurrency: req.destCurrency,
      transferAmount: (Number(req.destAmountMinor) / 100).toFixed(2), method, reason: REASON_BY_PURPOSE(req.purposeCode),
      reference: (req.invoiceNumber ?? req.transferId).slice(0, 30), quoteId: leg.live?.quoteId,
    });
    return { partnerRef: tr.id };
  }

  async createVirtualAccount(req: VirtualAccountRequest): Promise<VirtualAccountResult> {
    const acct = await this.client.createGlobalAccount({ requestId: requestId("va", req.entityId, req.currency), countryCode: req.country, currency: req.currency, nickname: req.legalName.slice(0, 40) });
    return {
      partnerRef: acct.id ?? requestId("va", req.entityId, req.currency),
      details: Object.fromEntries(Object.entries({ account_holder: acct.account_name ?? req.legalName, currency: req.currency, country: req.country, iban: acct.iban, account_number: acct.account_number, swift_code: acct.swift_code }).filter(([, v]) => typeof v === "string" && v) as [string, string][]),
    };
  }

  /** Airwallex signs HMAC-SHA256(secret, x-timestamp + body) as hex; deliveries older than 5 minutes are rejected (replay). */
  verifyWebhook(rawBody: string, headers: Headers): boolean {
    if (!this.webhookSecret) return false;
    const ts = headers.get("x-timestamp") ?? "";
    const sig = headers.get("x-signature") ?? "";
    const t = Number(ts);
    if (!Number.isFinite(t) || Math.abs(Date.now() - t) > 5 * 60_000) return false;
    const expected = createHmac("sha256", this.webhookSecret).update(ts + rawBody).digest("hex");
    const a = Buffer.from(sig), b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Event names follow Airwallex's "payout.transfer.*" scheme; confirm exact names with the smoke/webhook test in your account. */
  normalizeWebhook(payload: unknown): { id: string; type: string; data: Record<string, unknown> } | null {
    const p = payload as { id?: string; name?: string; data?: Record<string, any> };
    if (!p?.id || !p.name || !p.data) return null;
    const name = p.name.toLowerCase();
    const requestIdOfOurs = String(p.data.request_id ?? "");
    if (name.includes("transfer")) {
      if (/(paid|completed|settled)/.test(name) || (p.data.status === "PAID" || p.data.status === "COMPLETED")) return { id: p.id, type: "payout.completed", data: { transfer_ref: p.data.id, request_id: requestIdOfOurs, ...ours(p.data) } };
      if (/(fail|reject|cancel|return)/.test(name) || ["FAILED", "CANCELLED", "RETURNED"].includes(String(p.data.status))) return { id: p.id, type: "payout.failed", data: { transfer_ref: p.data.id, request_id: requestIdOfOurs, reason: String(p.data.failure_reason ?? p.data.status ?? name), ...ours(p.data) } };
    }
    return null;
  }
}

function ours(d: Record<string, any>) { return { reference: d.reference }; }

function countryForCurrency(c: string): string {
  return ({ USD: "US", EUR: "DE", GBP: "GB", AUD: "AU", SGD: "SG", HKD: "HK", CAD: "CA", JPY: "JP" } as Record<string, string>)[c] ?? "US";
}
