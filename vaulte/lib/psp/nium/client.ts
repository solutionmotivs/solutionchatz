// Nium REST client. Sandbox and live share https://gateway.nium.com/api; the key decides the environment.
// Written from Nium's public documentation (docs.nium.com) and checked against the sandbox with the account's key and clientHashId
// (see scripts/nium-live-check.ts and scripts/nium-e2e.ts).
import { randomUUID } from "crypto";
import { http, PartnerError } from "../http";

export interface NiumConfig { baseUrl: string; apiKey: string; clientHashId: string; clientName: string }

/** Our customer reference at Nium: "<customerHashId>:<walletHashId>". */
export const parseNiumRef = (ref: string): { customerHashId: string; walletHashId: string } => { const [customerHashId, walletHashId] = ref.split(":"); return { customerHashId, walletHashId: walletHashId ?? "" }; };

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
  /** Virtual account number (bank details in the customer's name) for one currency. */
  assignPaymentId(ref: { customerHashId: string; walletHashId: string }, currencyCode: string, bankName: string) {
    return this.call<{ bankName?: string; currencyCode?: string; uniquePaymentId?: string; uniquePayerId?: string | null }>("POST", this.c(`/customer/${ref.customerHashId}/wallet/${ref.walletHashId}/paymentId`), { currencyCode, bankName });
  }
  /** Virtual accounts already assigned to the customer's wallet, one per currency. */
  paymentIds(ref: { customerHashId: string; walletHashId: string }) { return this.call<{ paymentIds?: { currencyCode: string; bankName?: string; uniquePaymentId?: string; routingCodeType1?: string; routingCodeValue1?: string; routingCodeType2?: string; routingCodeValue2?: string; accountName?: string; bankNameFull?: string; bankAddress?: string }[] }>("GET", this.c(`/customer/${ref.customerHashId}`)).then(c => c.paymentIds ?? []); }
  /** Sandbox only: moves an onboarding application along (clear, reject, raise_rfi, submit_kyc). */
  simulateOnboarding(customerHashId: string, nextAction: string) { return this.call("POST", `/api/v5/simulations/onboard/${customerHashId}/transition`, { nextAction }); }
  simulatePayout(systemReferenceNumber: string, nextStatus: string) { return this.call("POST", `/api/v1/simulations/transactions/${systemReferenceNumber}/transition`, { nextStatus }); }
  transactions(ref: { customerHashId: string; walletHashId: string }) { return this.call<{ content?: Record<string, any>[] }>("GET", this.c(`/customer/${ref.customerHashId}/wallet/${ref.walletHashId}/transactions`)); }
  audit(ref: { customerHashId: string; walletHashId: string }, srn: string) { return this.call<Record<string, any>>("GET", this.c(`/customer/${ref.customerHashId}/wallet/${ref.walletHashId}/remittance/${srn}/audit`)); }
  wallet(ref: { customerHashId: string; walletHashId: string }) { return this.call<Record<string, any>>("GET", this.c(`/customer/${ref.customerHashId}/wallet/${ref.walletHashId}`)); }
  remit(ref: { customerHashId: string; walletHashId: string }, body: Record<string, unknown>) {
    return this.call<{ message?: string; system_reference_number?: string; payment_id?: string | null }>("POST", `/api/v1/client/${this.cfg.clientHashId}/customer/${ref.customerHashId}/wallet/${ref.walletHashId}/remittance`, body);
  }
  /** Sandbox only: simulates money arriving in the client's prefund wallet. */
  simulateInward(a: { amount: number; currency: string; country: string; bankSource: string; bankReferenceNumber: string }) { return this.call<{ success?: boolean; message?: string }>("POST", "/api/v1/inward/payment/manual", a); }
}

export function niumFromEnv(env = process.env): NiumClient | null {
  if (!env.NIUM_API_KEY || !env.NIUM_CLIENT_HASH_ID) return null;
  return new NiumClient({ baseUrl: env.NIUM_BASE_URL ?? "https://gateway.nium.com", apiKey: env.NIUM_API_KEY, clientHashId: env.NIUM_CLIENT_HASH_ID, clientName: (env.NIUM_CLIENT_NAME ?? "vaulte").slice(0, 32) });
}
