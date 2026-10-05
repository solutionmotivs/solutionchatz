// Wise Platform REST client (client-credentials OAuth). Sandbox: https://api.wise-sandbox.com  Live: https://api.wise.com
// Written from the public API reference; contract-tested against a local stub only. Run scripts/partner-smoke.mjs wise with your own credentials.
import { http, PartnerError } from "../http";

export interface WiseConfig { baseUrl: string; clientId: string; clientSecret: string; /** Wise profile id the transfers belong to (a business profile for Vaulte's partner account, or a customer profile). */ profileId?: string }

export class WiseClient {
  private tok: { v: string; exp: number } | null = null;
  private profile?: string;
  constructor(private cfg: WiseConfig) { this.profile = cfg.profileId; }

  private async token(force = false): Promise<string> {
    if (!force && this.tok && this.tok.exp > Date.now() + 30_000) return this.tok.v;
    const r = await http(`${this.cfg.baseUrl}/oauth/token`, { form: { grant_type: "client_credentials" }, headers: { Authorization: "Basic " + Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString("base64") } });
    if (r.status !== 200 || !r.json?.access_token) throw new PartnerError(r.status, "AUTH_FAILED", "Wise login failed");
    this.tok = { v: r.json.access_token, exp: Date.now() + Number(r.json.expires_in ?? 43_200) * 1000 };
    return this.tok.v;
  }

  async call<T = any>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const headers = { Authorization: `Bearer ${await this.token(attempt === 1)}` };
      const r = await http(`${this.cfg.baseUrl}${path}`, { method, headers, json: body });
      if (r.status >= 200 && r.status < 300) return r.json as T;
      if (r.status === 401 && attempt === 0) { this.tok = null; continue; }
      if ((r.status >= 500 || r.status === 429) && attempt < 2) { await new Promise(res => setTimeout(res, 400 * (attempt + 1))); continue; }
      const msg = r.json?.errors?.[0]?.message ?? r.json?.error_description ?? r.json?.message ?? r.status;
      throw new PartnerError(r.status, String(r.json?.errors?.[0]?.code ?? r.json?.error ?? `HTTP_${r.status}`), `Wise ${path} failed: ${msg}`);
    }
    throw new PartnerError(0, "UNREACHABLE", "Wise request failed after retries");
  }

  async profileId(): Promise<string> {
    if (this.profile) return this.profile;
    const list = await this.call<{ id: number; type: string }[]>("GET", "/v2/profiles");
    const p = list.find(x => x.type?.toLowerCase() === "business") ?? list[0];
    if (!p) throw new PartnerError(404, "NO_PROFILE", "Wise account has no profile");
    return (this.profile = String(p.id));
  }

  async createQuote(a: { sourceCurrency: string; targetCurrency: string; sourceAmount?: number; targetAmount?: number }) {
    const p = await this.profileId();
    return this.call<{ id: string; rate: number; sourceAmount: number; targetAmount: number; expirationTime?: string; paymentOptions?: { payIn?: string; payOut?: string; sourceAmount?: number; targetAmount?: number; fee?: { total?: number }; estimatedDelivery?: string; disabled?: boolean }[] }>("POST", `/v3/profiles/${p}/quotes`, { sourceCurrency: a.sourceCurrency, targetCurrency: a.targetCurrency, ...(a.targetAmount ? { targetAmount: a.targetAmount } : { sourceAmount: a.sourceAmount }) });
  }
  async createRecipient(a: { currency: string; type: string; accountHolderName: string; legalType: "PRIVATE" | "BUSINESS"; details: Record<string, unknown> }) {
    return this.call<{ id: number }>("POST", "/v1/accounts", { profile: Number(await this.profileId()), currency: a.currency, type: a.type, accountHolderName: a.accountHolderName, ownedByCustomer: false, details: { legalType: a.legalType, ...a.details } });
  }
  createTransfer(a: { targetAccount: number; quoteUuid: string; customerTransactionId: string; reference: string }) {
    return this.call<{ id: number; status?: string }>("POST", "/v1/transfers", { targetAccount: a.targetAccount, quoteUuid: a.quoteUuid, customerTransactionId: a.customerTransactionId, details: { reference: a.reference } });
  }
  async fundTransfer(transferId: number) { return this.call("POST", `/v3/profiles/${await this.profileId()}/transfers/${transferId}/payments`, { type: "BALANCE" }); }
}

export function wiseFromEnv(env = process.env): WiseClient | null {
  if (!env.WISE_CLIENT_ID || !env.WISE_CLIENT_SECRET) return null;
  return new WiseClient({ baseUrl: env.WISE_BASE_URL ?? (env.WISE_ENV === "live" ? "https://api.wise.com" : "https://api.wise-sandbox.com"), clientId: env.WISE_CLIENT_ID, clientSecret: env.WISE_CLIENT_SECRET, profileId: env.WISE_PROFILE_ID });
}
