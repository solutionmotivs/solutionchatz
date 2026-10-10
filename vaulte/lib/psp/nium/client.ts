// Nium REST client. Sandbox and live share https://gateway.nium.com/api; the key decides the environment.
// Written from Nium's public documentation (docs.nium.com) and checked against the sandbox with the account's key and clientHashId
// (see scripts/nium-live-check.ts and scripts/nium-e2e.ts).
import { randomUUID } from "crypto";
import { http, PartnerError } from "../http";

export interface NiumConfig { baseUrl: string; apiKey: string; clientHashId: string; clientName: string }

/** Our customer reference at Nium: "<customerHashId>:<walletHashId>". */
export const parseNiumRef = (ref: string): { customerHashId: string; walletHashId: string } => { const [customerHashId, walletHashId] = ref.split(":"); return { customerHashId, walletHashId: walletHashId ?? "" }; };

export interface NiumEntity { externalId?: string; referenceId?: string; firstName?: string; lastName?: string; kycStatus?: string; kycMode?: string | null; biometricUrl?: string | null; address?: { country?: string } | null }
export interface NiumCustomerV5 { customerHashId: string; status?: string; subStatus?: string | null; region?: string; wallets?: { walletHashId: string }[]; applicant?: NiumEntity; stakeholders?: { individual?: NiumEntity[] } | NiumEntity[] | null; [k: string]: unknown }
export interface NiumRfiTemplate { rfiHashId: string; templateId?: string; referenceId?: string; remarks?: string; status: string; template: { name: string; type: "data" | "document"; rfiType: "corporate" | "applicant" | "stakeholder"; documentType?: string; requiredFields: { fieldLabel: string; fieldValue: string; type: "data" | "document" }[] } }

export class NiumClient {
  constructor(private cfg: NiumConfig) {}
  get clientHashId() { return this.cfg.clientHashId; }
  get isSandbox() { return !process.env.NIUM_BASE_URL && process.env.NIUM_ENV !== "live"; }

  async call<T = any>(method: "GET" | "POST" | "PUT", path: string, body?: unknown, query?: Record<string, string | number | undefined>): Promise<T> {
    const qs = query ? "?" + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : "";
    for (let attempt = 0; attempt < 3; attempt++) {
      // A fresh x-request-id per attempt; Nium treats it as the idempotency handle for the call.
      const headers = { "x-api-key": this.cfg.apiKey, "x-request-id": randomUUID(), "x-client-name": this.cfg.clientName };
      const r = await http(`${this.cfg.baseUrl}${path}${qs}`, { method, headers, json: body, timeoutMs: 30_000 });
      if (r.status >= 200 && r.status < 300) return r.json as T;
      if ((r.status >= 500 || r.status === 429) && attempt < 2) { await new Promise(res => setTimeout(res, 500 * (attempt + 1))); continue; }
      const j = r.json ?? {};
      const first = j.errors?.[0]?.description ?? j.errors?.[0] ?? j.message ?? undefined;
      throw new PartnerError(r.status, String(j.errors?.[0]?.code ?? j.status ?? `HTTP_${r.status}`), `Nium ${path} failed: ${typeof first === "string" ? first : JSON.stringify(first ?? r.status)}`);
    }
    throw new PartnerError(0, "UNREACHABLE", "Nium request failed after retries");
  }

  private c(p = "") { return `/api/v1/client/${this.cfg.clientHashId}${p}`; }

  client() { return this.call<{ name?: string; countryCode?: string; paymentIds?: Record<string, string>[] }>("GET", this.c()); }
  /** Indicative rate (no lock). `exchangeRate` is units of destination per unit of source. */
  exchangeRate(a: { sourceCurrencyCode: string; destinationCurrencyCode: string; sourceAmount?: number }) {
    return this.call<{ quoteId?: string; exchangeRate: number; markupRate?: number; expiryDate?: string }>("GET", "/api/v2/exchangeRate", undefined, a);
  }
  constants(category: string, region: string, type: "corporate" | "individual" = "corporate") {
    return this.call<{ data: { code: string; description: string }[] }>("GET", `/api/v2/client/${this.cfg.clientHashId}/onboarding/constants`, undefined, { category, type, region, countryCode: region });
  }
  createCustomer(body: Record<string, unknown>) { return this.call<{ customerHashId: string; walletHashId?: string; status?: string; subStatus?: string; redirectUrl?: string; [k: string]: unknown }>("POST", `/api/v5/client/${this.cfg.clientHashId}/customers`, body); }
  getCustomer(customerHashId: string) { return this.call<{ customerHashId: string; walletHashId?: string; status?: string; subStatus?: string; kycStatus?: string; complianceStatus?: string; [k: string]: unknown }>("GET", this.c(`/customer/${customerHashId}`)); }
  /** The v5 customer record: status, subStatus and, per entity (applicant, stakeholders), its referenceId, kycStatus and the hosted identity-check link (biometricUrl). */
  customerV5(customerHashId: string) { return this.call<NiumCustomerV5>("GET", `/api/v5/client/${this.cfg.clientHashId}/customer/${customerHashId}`); }
  /** KYC for one entity of a corporate customer (the applicant and every individual stakeholder are separate). */
  submitKyc(customerHashId: string, body: Record<string, unknown>) { return this.call<{ kycStatus?: string; referenceId?: string; biometricUrl?: string; redirectUrl?: string; kycMode?: string }>("POST", `/api/v5/client/${this.cfg.clientHashId}/customer/${customerHashId}/submitKyc`, body); }
  /** Open information requests (RFIs) for a corporate customer. */
  corporateRfis(customerHashId: string) { return this.call<{ rfiTemplates?: NiumRfiTemplate[] }>("GET", this.c("/corporate/rfi"), undefined, { customerHashId }); }
  respondCorporateRfi(body: Record<string, unknown>) { return this.call<Record<string, unknown>>("POST", this.c("/corporate/rfi"), body); }
  /**
   * Uploads one document and returns Nium's fileId, to be referenced in onboarding. Multipart, one file per call (the gateway limit is 10 MB per request).
   * NOT proven on the sandbox: the account we hold answers "Missing Authentication Token" for /files, so the route is not enabled for it (ask Nium).
   */
  async uploadFile(data: Buffer, fileName: string, mimeType: string): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(data)], { type: mimeType }), fileName);
    const res = await fetch(`${this.cfg.baseUrl}${this.c("/files")}`, { method: "POST", headers: { "x-api-key": this.cfg.apiKey, "x-request-id": randomUUID(), "x-client-name": this.cfg.clientName, Accept: "application/json" }, body: form, signal: AbortSignal.timeout(60_000) });
    let j: any = null; try { j = await res.json(); } catch { /* not json */ }
    const id = j?.fileId ?? j?.id ?? j?.data?.fileId;
    if (res.ok && id) return String(id);
    const msg = j?.errors?.[0]?.description ?? j?.message ?? res.status;
    throw new PartnerError(res.status, String(j?.errors?.[0]?.code ?? `HTTP_${res.status}`), `Nium ${this.c("/files")} failed: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
  }
  /** Virtual account number (bank details in the customer's name) for one currency. */
  assignPaymentId(ref: { customerHashId: string; walletHashId: string }, currencyCode: string, bankName: string) {
    return this.call<{ bankName?: string; currencyCode?: string; uniquePaymentId?: string; uniquePayerId?: string | null }>("POST", this.c(`/customer/${ref.customerHashId}/wallet/${ref.walletHashId}/paymentId`), { currencyCode, bankName });
  }
  /** Virtual accounts already assigned to the customer's wallet, one per currency. */
  paymentIds(ref: { customerHashId: string; walletHashId: string }) { return this.call<{ paymentIds?: { currencyCode: string; bankName?: string; uniquePaymentId?: string; routingCodeType1?: string; routingCodeValue1?: string; routingCodeType2?: string; routingCodeValue2?: string; accountName?: string; bankNameFull?: string; bankAddress?: string }[] }>("GET", this.c(`/customer/${ref.customerHashId}`)).then(c => c.paymentIds ?? []); }
  /** Sandbox only: moves an onboarding application along (clear, reject, raise_rfi, submit_kyc). */
  simulateOnboarding(customerHashId: string, nextAction: string, extra: Record<string, unknown> = {}) { return this.call("POST", `/api/v5/simulations/onboard/${customerHashId}/transition`, { nextAction, ...extra }); }
  simulatePayout(systemReferenceNumber: string, nextStatus: string) { return this.call("POST", `/api/v1/simulations/transactions/${systemReferenceNumber}/transition`, { nextStatus }); }
  transactions(ref: { customerHashId: string; walletHashId: string }) { return this.call<{ content?: Record<string, any>[] }>("GET", this.c(`/customer/${ref.customerHashId}/wallet/${ref.walletHashId}/transactions`)); }
  audit(ref: { customerHashId: string; walletHashId: string }, srn: string) { return this.call<Record<string, any>>("GET", this.c(`/customer/${ref.customerHashId}/wallet/${ref.walletHashId}/remittance/${srn}/audit`)); }
  wallet(ref: { customerHashId: string; walletHashId: string }) { return this.call<Record<string, any>>("GET", this.c(`/customer/${ref.customerHashId}/wallet/${ref.walletHashId}`)); }
  remit(ref: { customerHashId: string; walletHashId: string }, body: Record<string, unknown>) {
    return this.call<{ message?: string; system_reference_number?: string; payment_id?: string | null }>("POST", `/api/v1/client/${this.cfg.clientHashId}/customer/${ref.customerHashId}/wallet/${ref.walletHashId}/remittance`, body);
  }
  /**
   * Sandbox only: simulates a third party paying into a customer's virtual account. The credit is matched to the wallet by
   * `virtualAccountNumber` and only settles when the payer (remitter) is described; without those it stays Pending/Unsettled.
   * It lands in the wallet a few seconds later (poll `wallet`/`transactions`).
   */
  simulateVanCredit(a: { virtualAccountNumber: string; amount: number; currency: string; bankSource: string; country: string; bankReferenceNumber: string; remitterName?: string }) {
    return this.call<{ success?: boolean; message?: string }>("POST", "/api/v1/inward/payment/manual", {
      amount: a.amount, currency: a.currency, country: a.country, bankSource: a.bankSource, bankReferenceNumber: a.bankReferenceNumber, virtualAccountNumber: a.virtualAccountNumber,
      remitterName: a.remitterName ?? "Sandbox Payer Inc", remitterBankName: "Sandbox Bank", remitterAccountNumber: "123456789", payMode: "WIRE", type: "CREDIT",
    });
  }
  /** Customer-level virtual account list with the bank source of each (v2). */
  vans(ref: { customerHashId: string; walletHashId: string }) { return this.call<{ content?: { currencyCode: string; uniquePaymentId: string; bankName?: string; status?: string }[] }>("GET", `/api/v2/client/${this.cfg.clientHashId}/customer/${ref.customerHashId}/wallet/${ref.walletHashId}/paymentIds`).then(r => r.content ?? []); }
  /** Client-level programme settings (webhook URLs, prefund and post-funded-payout flags, enabled currencies). */
  clientSettings() { return this.call<Record<string, any>>("GET", this.c()); }
}

export function niumFromEnv(env = process.env): NiumClient | null {
  if (!env.NIUM_API_KEY || !env.NIUM_CLIENT_HASH_ID) return null;
  return new NiumClient({ baseUrl: env.NIUM_BASE_URL ?? "https://gateway.nium.com", apiKey: env.NIUM_API_KEY, clientHashId: env.NIUM_CLIENT_HASH_ID, clientName: (env.NIUM_CLIENT_NAME ?? "vaulte").slice(0, 32) });
}
