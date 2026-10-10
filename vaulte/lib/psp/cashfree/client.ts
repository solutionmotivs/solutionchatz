// Cashfree Payouts v2 REST client (https://www.cashfree.com/docs/api-reference/payouts/v2). Plain HTTP on purpose: the npm package
// `cashfree-payout` (0.0.14, 2024) wraps the old v1 token flow and is not maintained for v2.
// Auth: x-client-id / x-client-secret plus either a whitelisted server IP or, where IPs change (shared hosting, serverless), the
// two-factor signature `x-cf-signature` = RSA-OAEP(Cashfree's public key, "<clientId>.<unix seconds>"), base64. The public key is the PEM
// downloaded from the Cashfree dashboard (Developers > Two-Factor Authentication > Public Key) and goes in CASHFREE_PUBLIC_KEY.
import { createHmac, publicEncrypt, randomUUID, constants, timingSafeEqual } from "crypto";
import { http, PartnerError } from "../http";

export interface CashfreeConfig { baseUrl: string; clientId: string; clientSecret: string; apiVersion: string; publicKeyPem?: string }

export interface CashfreeBeneficiaryDetails {
  beneficiary_name: string;
  beneficiary_instrument_details: { bank_account_number?: string; bank_ifsc?: string; vpa?: string };
  beneficiary_contact_details?: { beneficiary_email?: string; beneficiary_phone?: string; beneficiary_country_code?: string; beneficiary_address?: string; beneficiary_city?: string; beneficiary_state?: string; beneficiary_postal_code?: string };
}
export interface CashfreeTransferRequest {
  transfer_id: string;
  transfer_amount: number;
  transfer_currency: "INR";
  transfer_mode?: string;
  transfer_remarks?: string;
  beneficiary_details?: CashfreeBeneficiaryDetails & { beneficiary_id?: string };
  fundsource_id?: string;
}
export interface CashfreeTransfer {
  transfer_id: string; cf_transfer_id?: string; status: string; status_code?: string; status_description?: string; transfer_utr?: string | null;
  transfer_amount?: number; transfer_mode?: string; transfer_service_charge?: number; transfer_service_tax?: number; added_on?: string; updated_on?: string; transfer_currency?: string;
  beneficiary_details?: Record<string, unknown>;
}

export class CashfreeClient {
  constructor(private cfg: CashfreeConfig) {}
  get isSandbox() { return /sandbox/.test(this.cfg.baseUrl); }
  get clientSecret() { return this.cfg.clientSecret; }
  get signs() { return !!this.cfg.publicKeyPem; }

  /** `x-cf-signature` for this moment; null when no public key is configured (then the caller's IP must be whitelisted at Cashfree). */
  signature(now = Date.now()): string | null {
    if (!this.cfg.publicKeyPem) return null;
    const payload = Buffer.from(`${this.cfg.clientId}.${Math.floor(now / 1000)}`);
    return publicEncrypt({ key: this.cfg.publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" }, payload).toString("base64");
  }

  async call<T = any>(method: "GET" | "POST" | "PUT", path: string, body?: unknown, query?: Record<string, string | number | undefined>, requestId?: string): Promise<T> {
    const qs = query ? "?" + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const headers: Record<string, string> = { "x-client-id": this.cfg.clientId, "x-client-secret": this.cfg.clientSecret, "x-api-version": this.cfg.apiVersion, "x-request-id": requestId ?? randomUUID() };
      const sig = this.signature(); if (sig) headers["x-cf-signature"] = sig;
      const r = await http(`${this.cfg.baseUrl}${path}${qs}`, { method, headers, json: body, timeoutMs: 30_000 });
      if (r.status >= 200 && r.status < 300) return r.json as T;
      // Retry only where repeating is safe: a transient gateway error or throttling. A POST /transfers carries our transfer_id, so Cashfree rejects a duplicate rather than paying twice.
      if ((r.status >= 502 || r.status === 429) && attempt < 2) { await new Promise(res => setTimeout(res, 500 * (attempt + 1))); continue; }
      const j = r.json ?? {};
      throw new PartnerError(r.status, String(j.code || j.type || `HTTP_${r.status}`), `Cashfree ${method} ${path} failed: ${j.message ?? r.status}${j.type ? ` (${j.type})` : ""}`);
    }
    throw new PartnerError(0, "UNREACHABLE", "Cashfree request failed after retries");
  }

  /** Cheap authenticated read: used to prove keys, signature / IP whitelist and API version without moving money. */
  ping() { return this.call<{ code?: string; message?: string }>("GET", "/beneficiary", undefined, { beneficiary_id: "vaulte_ping" }).then(() => true, (e: PartnerError) => { if (e.status === 404 || e.code === "beneficiary_not_found") return true; throw e; }); }
  createTransfer(body: CashfreeTransferRequest) { return this.call<CashfreeTransfer>("POST", "/transfers", body, undefined, body.transfer_id); }
  getTransfer(transferId: string) { return this.call<CashfreeTransfer>("GET", "/transfers", undefined, { transfer_id: transferId }); }

  /** V2 webhook signature: base64(HMAC-SHA256(client secret, timestamp + raw body)) in x-webhook-signature, timestamp in x-webhook-timestamp. */
  verifyWebhookSignature(rawBody: string, signature: string, timestamp: string): boolean {
    if (!signature || !timestamp) return false;
    const mine = createHmac("sha256", this.cfg.clientSecret).update(timestamp + rawBody).digest("base64");
    const a = Buffer.from(mine), b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

const pem = (v: string) => v.includes("-----BEGIN") ? v.replace(/\\n/g, "\n") : "";
export function cashfreeFromEnv(env = process.env): CashfreeClient | null {
  if (!env.CASHFREE_CLIENT_ID || !env.CASHFREE_CLIENT_SECRET) return null;
  const live = env.CASHFREE_ENV === "production" || env.CASHFREE_ENV === "live";
  return new CashfreeClient({
    baseUrl: env.CASHFREE_BASE_URL ?? (live ? "https://api.cashfree.com/payout" : "https://sandbox.cashfree.com/payout"),
    clientId: env.CASHFREE_CLIENT_ID, clientSecret: env.CASHFREE_CLIENT_SECRET, apiVersion: env.CASHFREE_API_VERSION ?? "2024-01-01",
    publicKeyPem: env.CASHFREE_PUBLIC_KEY ? pem(env.CASHFREE_PUBLIC_KEY) || undefined : undefined,
  });
}
