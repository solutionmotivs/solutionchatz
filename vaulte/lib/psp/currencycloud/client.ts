// Currencycloud (Visa) REST client. Demo: https://devapi.currencycloud.com  Live: https://api.currencycloud.com
// Written from the public API reference; contract-tested against a local stub only (their demo needs your credentials:
// run scripts/partner-smoke.mjs currencycloud with CURRENCYCLOUD_LOGIN_ID / CURRENCYCLOUD_API_KEY).
import { createHash } from "crypto";
import { http, PartnerError } from "../http";

export interface CcConfig { baseUrl: string; loginId: string; apiKey: string; /** act on behalf of a sub-account (contact id) */ onBehalfOf?: string }

/** Deterministic id so a retried operation is recognised as the same one (their unique_request_id). */
export const uniqueId = (...p: string[]) => createHash("sha256").update(p.join("|")).digest("hex").slice(0, 40);

export class CurrencycloudClient {
  private tok: { v: string; at: number } | null = null;
  constructor(private cfg: CcConfig) {}

  /** Tokens expire after 5 minutes of inactivity: refresh proactively after 4. */
  private async token(force = false): Promise<string> {
    if (!force && this.tok && Date.now() - this.tok.at < 4 * 60_000) { this.tok.at = Date.now(); return this.tok.v; }
    const r = await http(`${this.cfg.baseUrl}/v2/authenticate/api`, { form: { login_id: this.cfg.loginId, api_key: this.cfg.apiKey } });
    if (r.status !== 200 || !r.json?.auth_token) throw new PartnerError(r.status, "AUTH_FAILED", "Currencycloud login failed");
    this.tok = { v: r.json.auth_token, at: Date.now() };
    return this.tok.v;
  }

  async call<T = any>(method: "GET" | "POST", path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const headers: Record<string, string> = { "X-Auth-Token": await this.token(attempt === 1) };
      const p = { ...params, ...(this.cfg.onBehalfOf ? { on_behalf_of: this.cfg.onBehalfOf } : {}) };
      const r = method === "GET"
        ? await http(`${this.cfg.baseUrl}${path}?${new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))}`, { headers })
        : await http(`${this.cfg.baseUrl}${path}`, { headers, form: p });
      if (r.status >= 200 && r.status < 300) return r.json as T;
      if (r.status === 401 && attempt === 0) { this.tok = null; continue; }
      if ((r.status >= 500 || r.status === 429) && attempt < 2) { await new Promise(res => setTimeout(res, 400 * (attempt + 1))); continue; }
      const first = r.json?.error_messages ? Object.values(r.json.error_messages as Record<string, { message?: string }[]>)[0]?.[0]?.message : undefined;
      throw new PartnerError(r.status, String(r.json?.error_code ?? `HTTP_${r.status}`), `Currencycloud ${path} failed: ${first ?? r.status}`);
    }
    throw new PartnerError(0, "UNREACHABLE", "Currencycloud request failed after retries");
  }

  /** Indicative client rate and the amounts it implies. fixed_side=sell: we sell `amount` of sellCurrency. */
  detailedRate(a: { sellCurrency: string; buyCurrency: string; sellAmount: string }) {
    return this.call<{ client_rate: string; client_buy_amount: string; client_sell_amount: string; mid_market_rate?: string; settlement_cut_off_time?: string; currency_pair?: string }>("GET", "/v2/rates/detailed", { sell_currency: a.sellCurrency, buy_currency: a.buyCurrency, fixed_side: "sell", amount: a.sellAmount, conversion_date_preference: "default" });
  }
  createConversion(a: { requestId: string; sellCurrency: string; buyCurrency: string; buyAmount: string; reason: string }) {
    return this.call<{ id: string; status?: string; settlement_date?: string; client_rate?: string }>("POST", "/v2/conversions/create", { buy_currency: a.buyCurrency, sell_currency: a.sellCurrency, fixed_side: "buy", amount: a.buyAmount, reason: a.reason, term_agreement: true, unique_request_id: a.requestId });
  }
  createBeneficiary(a: Record<string, string | undefined>) { return this.call<{ id: string }>("POST", "/v2/beneficiaries/create", a); }
  createPayment(a: { requestId: string; currency: string; beneficiaryId: string; amount: string; reason: string; reference: string; conversionId?: string; priority?: boolean }) {
    return this.call<{ id: string; status?: string; short_reference?: string }>("POST", "/v2/payments/create", { currency: a.currency, beneficiary_id: a.beneficiaryId, amount: a.amount, reason: a.reason, reference: a.reference, payment_type: a.priority ? "priority" : "regular", conversion_id: a.conversionId, unique_request_id: a.requestId });
  }
  /** Currencies this account can trade (the demo and each live account differ; do not assume a fixed list). */
  currencies() { return this.call<{ currencies?: { code: string }[] }>("GET", "/v2/reference/currencies"); }
  fundingAccount(currency: string) { return this.call<{ funding_accounts?: { account_number?: string; account_number_type?: string; routing_code?: string; routing_code_type?: string; account_holder_name?: string; bank_name?: string; currency?: string; id?: string }[] }>("GET", "/v2/funding_accounts/find", { currency }); }
}

export function currencycloudFromEnv(env = process.env): CurrencycloudClient | null {
  if (!env.CURRENCYCLOUD_LOGIN_ID || !env.CURRENCYCLOUD_API_KEY) return null;
  return new CurrencycloudClient({ baseUrl: env.CURRENCYCLOUD_BASE_URL ?? (env.CURRENCYCLOUD_ENV === "live" ? "https://api.currencycloud.com" : "https://devapi.currencycloud.com"), loginId: env.CURRENCYCLOUD_LOGIN_ID, apiKey: env.CURRENCYCLOUD_API_KEY, onBehalfOf: env.CURRENCYCLOUD_ON_BEHALF_OF });
}
