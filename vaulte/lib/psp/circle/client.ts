// Circle Mint REST client. Sandbox: https://api-sandbox.circle.com   Live: https://api.circle.com   (Bearer API key)
// Written from Circle's published OpenAPI (developers.circle.com, account.yaml). Verified live only for GET /ping and the
// unauthenticated 401 on the business-account paths; everything else is contract-tested against a local stub.
// Run `node scripts/partner-smoke.mjs circle` with your sandbox key before relying on it.
import { randomUUID } from "crypto";
import { http, PartnerError } from "../http";

export interface CircleConfig { baseUrl: string; apiKey: string }

/** Vaulte chain ids -> Circle chain codes. TRON is not offered for Mint deposits, so it is deliberately absent. */
export const CIRCLE_CHAINS: Record<string, string> = { solana: "SOL", base: "BASE", ethereum: "ETH", polygon: "POLY" };
export const CIRCLE_CURRENCY_FOR_TOKEN: Record<string, "USD" | "EUR"> = { USDC: "USD", EURC: "EUR" };

export class CircleClient {
  constructor(private cfg: CircleConfig) {}

  async call<T = any>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await http(`${this.cfg.baseUrl}${path}`, { method, headers: { Authorization: `Bearer ${this.cfg.apiKey}` }, json: body });
      if (r.status >= 200 && r.status < 300) return r.json as T;
      if ((r.status >= 500 || r.status === 429) && attempt < 2) { await new Promise(res => setTimeout(res, 400 * (attempt + 1))); continue; }
      throw new PartnerError(r.status, String(r.json?.code ?? `HTTP_${r.status}`), `Circle ${path} failed: ${r.json?.message ?? r.status}`);
    }
    throw new PartnerError(0, "UNREACHABLE", "Circle request failed after retries");
  }

  /** Unauthenticated liveness check. */
  async ping(): Promise<boolean> { const r = await http(`${this.cfg.baseUrl}/ping`); return r.status === 200; }

  /** New blockchain deposit address in the Mint wallet for USD (=USDC) or EUR (=EURC). */
  createDepositAddress(a: { idempotencyKey?: string; currency: "USD" | "EUR"; chain: string }) {
    return this.call<{ data: { id: string; address: string; addressTag: string | null; chain: string; currency: string } }>("POST", "/v1/businessAccount/wallets/addresses/deposit", { idempotencyKey: a.idempotencyKey ?? randomUUID(), currency: a.currency, chain: a.chain });
  }

  /** Wire instructions for funding the Mint account from a registered bank account. The trackingRef must be in the wire memo. */
  wireInstructions(wireAccountId: string) {
    return this.call<{ data: { trackingRef: string; beneficiary: { name?: string; address1?: string; address2?: string }; beneficiaryBank: { name?: string; swiftCode?: string; routingNumber?: string; accountNumber?: string; currency?: string; country?: string } } }>("GET", `/v1/businessAccount/banks/wires/${encodeURIComponent(wireAccountId)}/instructions`);
  }

  /** Redemption (off-ramp) to a bank account ALREADY registered on the Mint account (first-party destination). */
  createPayout(a: { idempotencyKey: string; destination: { type: "wire" | "sepa" | "sepa_instant"; id: string }; amount: { amount: string; currency: "USD" | "EUR" }; beneficiaryEmail: string; customerExternalRef?: string }) {
    return this.call<{ data: { id: string; status: string; amount: { amount: string; currency: string } } }>("POST", "/v1/businessAccount/payouts", {
      idempotencyKey: a.idempotencyKey, destination: a.destination, amount: a.amount, toAmount: { currency: a.amount.currency },
      metadata: { beneficiaryEmail: a.beneficiaryEmail, ...(a.customerExternalRef ? { customerExternalRef: a.customerExternalRef } : {}) },
    });
  }
  getPayout(id: string) { return this.call<{ data: { id: string; status: "pending" | "complete" | "failed"; errorCode?: string | null } }>("GET", `/v1/businessAccount/payouts/${encodeURIComponent(id)}`); }
  getTransfer(id: string) { return this.call<{ data: { id: string; status: "pending" | "complete" | "failed"; errorCode?: string | null } }>("GET", `/v1/businessAccount/transfers/${encodeURIComponent(id)}`); }
}

export function circleFromEnv(env = process.env): CircleClient | null {
  if (!env.CIRCLE_API_KEY) return null;
  return new CircleClient({ baseUrl: env.CIRCLE_BASE_URL ?? (env.CIRCLE_ENV === "live" ? "https://api.circle.com" : "https://api-sandbox.circle.com"), apiKey: env.CIRCLE_API_KEY });
}
