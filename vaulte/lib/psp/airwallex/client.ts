// Airwallex REST client (sandbox: https://api.sandbox.airwallex.com, live: https://api.airwallex.com).
// Written from Airwallex's public API reference. It is contract-tested against a local stub only: run
// scripts/airwallex-smoke.mjs with YOUR sandbox keys to confirm field names against the real service.
import { createHash } from "crypto";

export interface AirwallexConfig {
  baseUrl: string;
  clientId: string;
  apiKey: string;
  /** Connected-account id (acct_...) when acting for a customer's own Airwallex account. */
  onBehalfOf?: string;
  timeoutMs?: number;
}

export class AirwallexError extends Error {
  constructor(public status: number, public code: string, message: string, public source?: string) { super(message); }
  /** 4xx (except auth/rate-limit) = Airwallex refused this request; retrying the same request will not help. */
  get permanent() { return this.status >= 400 && this.status < 500 && ![401, 408, 429].includes(this.status); }
}

/** Deterministic UUID (v5-style) so retries of the same logical operation reuse the same request_id. */
export function requestId(...parts: string[]): string {
  const h = createHash("sha256").update(parts.join("|")).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export const PATHS = {
  login: "/api/v1/authentication/login",
  quote: "/api/v1/fx/quotes/create",
  /** Airwallex documents the conversion create endpoint under both /fx/conversions and /conversions across versions. */
  conversion: process.env.AIRWALLEX_CONVERSION_PATH ?? "/api/v1/fx/conversions/create",
  beneficiary: "/api/v1/beneficiaries/create",
  transfer: "/api/v1/transfers/create",
  transferGet: (id: string) => `/api/v1/transfers/${encodeURIComponent(id)}`,
  globalAccount: "/api/v1/global_accounts/create",
} as const;

export class AirwallexClient {
  private tok: { value: string; expiresAt: number } | null = null;
  constructor(private cfg: AirwallexConfig) {}

  private async raw(method: string, path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.cfg.timeoutMs ?? 20_000);
    try {
      const res = await fetch(this.cfg.baseUrl + path, {
        method, signal: ctl.signal,
        headers: { "Content-Type": "application/json", ...opts.headers },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
      let json: any = null;
      try { json = await res.json(); } catch {}
      return { status: res.status, json };
    } finally {
      clearTimeout(t);
    }
  }

  /** Bearer tokens last ~30 minutes: refresh a few minutes early. */
  private async token(force = false): Promise<string> {
    if (!force && this.tok && this.tok.expiresAt > Date.now() + 120_000) return this.tok.value;
    const r = await this.raw("POST", PATHS.login, { headers: { "x-client-id": this.cfg.clientId, "x-api-key": this.cfg.apiKey } });
    const token = r.json?.token;
    if ((r.status !== 200 && r.status !== 201) || typeof token !== "string") throw new AirwallexError(r.status, "AUTH_FAILED", "Airwallex login failed");
    const exp = r.json?.expires_at ? Date.parse(r.json.expires_at) : NaN;
    this.tok = { value: token, expiresAt: Number.isFinite(exp) ? exp : Date.now() + 25 * 60_000 };
    return token;
  }

  async call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const headers: Record<string, string> = { Authorization: `Bearer ${await this.token(attempt === 1)}` };
      if (this.cfg.onBehalfOf) headers["x-on-behalf-of"] = this.cfg.onBehalfOf;
      const r = await this.raw(method, path, { body, headers });
      if (r.status >= 200 && r.status < 300) return r.json as T;
      if (r.status === 401 && attempt === 0) { this.tok = null; continue; } // token expired mid-flight
      const retriable = (r.status >= 500 || r.status === 429) && (method === "GET" || body !== undefined && attempt < 2);
      // POSTs carry a request_id, so retrying a 5xx / 429 is safe (Airwallex de-duplicates on request_id).
      if (retriable && attempt < 2) { await new Promise(res => setTimeout(res, 400 * (attempt + 1))); continue; }
      throw new AirwallexError(r.status, String(r.json?.code ?? `HTTP_${r.status}`), String(r.json?.message ?? "Airwallex request failed"), r.json?.source);
    }
    throw new AirwallexError(0, "UNREACHABLE", "Airwallex request failed after retries");
  }

  // ── FX ────────────────────────────────────────────────────────────────────────
  createFxQuote(a: { sellCurrency: string; buyCurrency: string; sellAmount: string; validity?: string }) {
    return this.call<{ quote_id: string; client_rate?: number | string; awx_rate?: number | string; currency_pair?: string; buy_amount?: number | string; sell_amount?: number | string; valid_to_at?: string; valid_from_at?: string }>("POST", PATHS.quote, {
      sell_currency: a.sellCurrency, buy_currency: a.buyCurrency, sell_amount: a.sellAmount, validity: a.validity ?? "MIN_15",
    });
  }

  createConversion(a: { requestId: string; sellCurrency: string; buyCurrency: string; sellAmount: string; quoteId?: string; reason?: string }) {
    return this.call<{ conversion_id?: string; id?: string; status?: string; client_rate?: number | string }>("POST", PATHS.conversion, {
      request_id: a.requestId, sell_currency: a.sellCurrency, buy_currency: a.buyCurrency, sell_amount: a.sellAmount,
      ...(a.quoteId ? { quote_id: a.quoteId } : {}), ...(a.reason ? { reason: a.reason } : {}),
    });
  }

  // ── Payouts ───────────────────────────────────────────────────────────────────
  createBeneficiary(a: { requestId: string; nickname?: string; entityType: "PERSONAL" | "COMPANY"; name: string; bank: BankDetails; address?: Address; methods: Array<"LOCAL" | "SWIFT"> }) {
    const person = a.entityType === "PERSONAL" ? splitName(a.name) : null;
    return this.call<{ id?: string; beneficiary_id?: string }>("POST", PATHS.beneficiary, {
      request_id: a.requestId,
      nickname: a.nickname,
      beneficiary: {
        type: "BANK_ACCOUNT", entity_type: a.entityType,
        ...(person ? { first_name: person.first, last_name: person.last } : { company_name: a.name }),
        bank_details: a.bank,
        ...(a.address ? { address: a.address } : {}),
      },
      transfer_methods: a.methods,
    });
  }

  createTransfer(a: { requestId: string; beneficiaryId: string; sourceCurrency: string; transferCurrency: string; transferAmount: string; method: "LOCAL" | "SWIFT"; reason: string; reference: string; quoteId?: string; feePaidBy?: "PAYER" | "BENEFICIARY" }) {
    return this.call<{ id: string; status?: string; amount_beneficiary_receives?: number | string; amount_payer_pays?: number | string }>("POST", PATHS.transfer, {
      request_id: a.requestId, beneficiary_id: a.beneficiaryId, source_currency: a.sourceCurrency, transfer_currency: a.transferCurrency,
      transfer_amount: a.transferAmount, transfer_method: a.method, reason: a.reason, reference: a.reference,
      ...(a.quoteId ? { quote_id: a.quoteId, lock_rate_on_create: true } : {}), fee_paid_by: a.feePaidBy ?? "PAYER",
    });
  }

  getTransfer(id: string) { return this.call<{ id: string; status: string }>("GET", PATHS.transferGet(id)); }

  createGlobalAccount(a: { requestId: string; countryCode: string; currency: string; nickname: string }) {
    return this.call<{ id?: string; account_name?: string; account_number?: string; iban?: string; routing_codes?: unknown; swift_code?: string; institution?: { name?: string; address?: string } }>("POST", PATHS.globalAccount, {
      request_id: a.requestId, country_code: a.countryCode, nick_name: a.nickname,
      required_features: [{ transfer_method: "LOCAL", currency: a.currency }],
    });
  }
}

export interface BankDetails {
  account_name: string;
  account_currency: string;
  bank_country_code: string;
  account_number?: string;
  iban?: string;
  swift_code?: string;
  account_routing_type1?: string;
  account_routing_value1?: string;
  local_clearing_system?: string;
  bank_name?: string;
}
export interface Address { street_address: string; city: string; state?: string; postcode?: string; country_code: string }

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  return parts.length === 1 ? { first: parts[0], last: parts[0] } : { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

export function airwallexFromEnv(env = process.env): AirwallexClient | null {
  if (!env.AIRWALLEX_CLIENT_ID || !env.AIRWALLEX_API_KEY) return null;
  const live = env.AIRWALLEX_ENV === "live";
  return new AirwallexClient({
    baseUrl: env.AIRWALLEX_BASE_URL ?? (live ? "https://api.airwallex.com" : "https://api.sandbox.airwallex.com"),
    clientId: env.AIRWALLEX_CLIENT_ID, apiKey: env.AIRWALLEX_API_KEY, onBehalfOf: env.AIRWALLEX_ON_BEHALF_OF,
  });
}
