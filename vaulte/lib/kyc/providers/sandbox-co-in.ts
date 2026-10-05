// Sandbox.co.in KYC adapter (PAN, GSTIN, bank penny-drop). Endpoints follow their public API reference
// (Oct 2026). NOT verified against the live service from this repo's CI: run scripts/kyc-smoke.mjs with your keys.
// Note: PAN verify and penny-drop are billable calls; GSTIN is a public-register lookup.
import type { CheckInput, CheckResult, VerificationProvider } from "./types";

interface Cfg { baseUrl: string; apiKey: string; apiSecret: string; timeoutMs?: number }

export class SandboxCoInProvider implements VerificationProvider {
  readonly name = "sandbox_co_in";
  private token: { value: string; expiresAt: number } | null = null;
  constructor(private cfg: Cfg) {}

  supports(code: string, country: string) {
    return country === "IN" && (code === "PAN" || code === "GSTIN" || code === "BANK_ACCOUNT");
  }

  private async http(path: string, init: RequestInit & { authed?: boolean } = {}): Promise<{ status: number; json: any }> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.cfg.timeoutMs ?? 15000);
    try {
      const res = await fetch(this.cfg.baseUrl + path, { ...init, signal: ctl.signal });
      let json: any = null;
      try { json = await res.json(); } catch {}
      return { status: res.status, json };
    } finally {
      clearTimeout(t);
    }
  }

  /** Access tokens live 24h; refresh an hour early. */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const r = await this.http("/authenticate", {
      method: "POST",
      headers: { "x-api-key": this.cfg.apiKey, "x-api-secret": this.cfg.apiSecret, "x-api-version": "1.0" },
    });
    const tok = r.json?.data?.access_token;
    if (r.status !== 200 || typeof tok !== "string") throw new Error(`authenticate failed (${r.status})`);
    this.token = { value: tok, expiresAt: Date.now() + 23 * 3600 * 1000 };
    return tok;
  }

  private async headers(): Promise<Record<string, string>> {
    // The token goes in Authorization without a Bearer prefix.
    return { Authorization: await this.accessToken(), "x-api-key": this.cfg.apiKey, "Content-Type": "application/json" };
  }

  async verify(i: CheckInput): Promise<CheckResult> {
    try {
      if (i.code === "PAN") return await this.pan(i);
      if (i.code === "GSTIN") return await this.gstin(i);
      return await this.bank(i);
    } catch (e) {
      return { status: "UNAVAILABLE", provider: this.name, details: {}, reason: e instanceof Error ? e.message : "provider error" };
    }
  }

  private async pan(i: CheckInput): Promise<CheckResult> {
    if (!i.name || !i.dateOfBirth) return { status: "UNAVAILABLE", provider: this.name, details: {}, reason: "name and date of birth/incorporation are needed for the PAN check" };
    const r = await this.http("/kyc/pan/verify", {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify({
        "@entity": "in.co.sandbox.kyc.pan_verification.request",
        pan: i.value, name_as_per_pan: i.name, date_of_birth: i.dateOfBirth, consent: "Y", reason: "KYC for cross-border payment account",
      }),
    });
    if (r.status !== 200) return this.failure(r);
    const d = r.json?.data ?? {};
    const ok = d.status === "valid" && d.name_as_per_pan_match === true && d.date_of_birth_match === true;
    return {
      status: ok ? "VERIFIED" : "FAILED", provider: this.name, providerRef: r.json?.transaction_id,
      details: { status: d.status, category: d.category, name_match: d.name_as_per_pan_match, dob_match: d.date_of_birth_match, aadhaar_seeding: d.aadhaar_seeding_status },
      reason: ok ? undefined : d.status !== "valid" ? "PAN is not valid" : "Name or date of birth does not match the PAN record",
    };
  }

  private async gstin(i: CheckInput): Promise<CheckResult> {
    const r = await this.http("/gst/compliance/public/gstin/verify", { method: "POST", headers: await this.headers(), body: JSON.stringify({ gstin: i.value }) });
    if (r.status !== 200) return this.failure(r);
    const d = r.json?.data?.data ?? {};
    const active = d.validGstin === true && String(d.status).toLowerCase() === "active";
    return {
      status: active ? "VERIFIED" : "FAILED", provider: this.name, providerRef: r.json?.transaction_id,
      details: { registered_name: d.legalName, status: d.status, state: d.stateName, registered_pan: d.pan },
      reason: active ? undefined : "GSTIN is not active",
    };
  }

  private async bank(i: CheckInput): Promise<CheckResult> {
    const [ifsc, acct] = i.value.split("|");
    const q = i.name ? `?name=${encodeURIComponent(i.name.slice(0, 100))}` : "";
    const r = await this.http(`/bank/${encodeURIComponent(ifsc)}/accounts/${encodeURIComponent(acct)}/verify${q}`, { method: "GET", headers: await this.headers() });
    if (r.status !== 200) return this.failure(r);
    const d = r.json?.data ?? {};
    return {
      status: d.account_exists === true ? "VERIFIED" : "FAILED", provider: this.name, providerRef: r.json?.transaction_id,
      details: { account_exists: d.account_exists, name_at_bank: d.name_at_bank },
      reason: d.account_exists === true ? undefined : "Bank account could not be verified",
    };
  }

  /** 4xx = the provider answered "no"; 5xx / 429 / network = try later (manual fallback). */
  private failure(r: { status: number; json: any }): CheckResult {
    const msg = r.json?.message ?? r.json?.error ?? `HTTP ${r.status}`;
    if (r.status >= 500 || r.status === 429 || r.status === 401 || r.status === 403) {
      return { status: "UNAVAILABLE", provider: this.name, details: {}, reason: String(msg) };
    }
    return { status: "FAILED", provider: this.name, providerRef: r.json?.transaction_id, details: {}, reason: String(msg) };
  }
}
