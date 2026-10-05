// OAuth2 + REST connectors for QuickBooks Online, Zoho Books and Xero. Written from each vendor's public API reference and
// contract-tested against local stubs only: going live needs YOUR developer app (client id/secret, redirect URI) at each vendor.
// Each pushes one balanced journal per transfer (see lib/erp/vouchers.ts), using accounts YOU map in settings.
import { createHash } from "crypto";
import { DEFAULT_MAPPING, money, type ErpMapping, type Voucher } from "../vouchers";

export interface Tokens { access: string; refresh?: string; expiresAt?: Date }
export interface Ctx { tokens: Tokens; tenant: string; mapping: ErpMapping }

export class ErpAuthError extends Error {}
export class ErpApiError extends Error { constructor(public status: number, message: string) { super(message); } get permanent() { return this.status >= 400 && this.status < 500 && this.status !== 429; } }

export interface ErpAdapter {
  id: "QUICKBOOKS" | "ZOHO" | "XERO";
  label: string;
  configured(): boolean;
  authUrl(state: string, redirectUri: string): string;
  connect(code: string, redirectUri: string, query: Record<string, string>): Promise<{ tokens: Tokens; tenant: string }>;
  refresh(tokens: Tokens): Promise<Tokens>;
  push(ctx: Ctx, v: Voucher): Promise<{ externalId: string }>;
}

const T = 20_000;
async function call(url: string, init: RequestInit): Promise<{ status: number; json: any }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(T) });
  let json: any = null; try { json = await res.json(); } catch {}
  if (res.status === 401) throw new ErpAuthError("The accounting system rejected our access token");
  return { status: res.status, json };
}
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const exp = (s?: number) => (s ? new Date(Date.now() + s * 1000) : undefined);
const major = (m: bigint, c: string) => Number(money(m, c));

function accounts(v: Voucher, mapping: ErpMapping) {
  const m = { ...DEFAULT_MAPPING, ...mapping };
  return (role: string) => (role === "BANK" ? m.bank : role === "CHARGES" ? m.charges : m.party);
}

function checkOk(r: { status: number; json: any }, what: string) {
  if (r.status >= 200 && r.status < 300) return;
  throw new ErpApiError(r.status, `${what} failed (HTTP ${r.status}): ${String(r.json?.Fault?.Error?.[0]?.Detail ?? r.json?.message ?? r.json?.Message ?? r.json?.error ?? "").slice(0, 300)}`);
}

// ── QuickBooks Online ────────────────────────────────────────────────────────────
export const quickbooks: ErpAdapter = {
  id: "QUICKBOOKS", label: "QuickBooks Online",
  configured: () => !!(process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET),
  authUrl: (state, redirectUri) => `${process.env.QUICKBOOKS_AUTH_URL ?? "https://appcenter.intuit.com/connect/oauth2"}?${form({ client_id: process.env.QUICKBOOKS_CLIENT_ID!, response_type: "code", scope: "com.intuit.quickbooks.accounting", redirect_uri: redirectUri, state })}`,
  async connect(code, redirectUri, query) {
    const r = await call(process.env.QUICKBOOKS_TOKEN_URL ?? "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", { method: "POST", headers: { Authorization: basic(process.env.QUICKBOOKS_CLIENT_ID!, process.env.QUICKBOOKS_CLIENT_SECRET!), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: form({ grant_type: "authorization_code", code, redirect_uri: redirectUri }) });
    checkOk(r, "QuickBooks token exchange");
    if (!query.realmId) throw new ErpApiError(400, "QuickBooks did not return a company (realmId)");
    return { tokens: { access: r.json.access_token, refresh: r.json.refresh_token, expiresAt: exp(r.json.expires_in) }, tenant: query.realmId };
  },
  async refresh(t) {
    const r = await call(process.env.QUICKBOOKS_TOKEN_URL ?? "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", { method: "POST", headers: { Authorization: basic(process.env.QUICKBOOKS_CLIENT_ID!, process.env.QUICKBOOKS_CLIENT_SECRET!), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: form({ grant_type: "refresh_token", refresh_token: t.refresh ?? "" }) });
    if (r.status >= 400) throw new ErpAuthError("QuickBooks refresh token expired: reconnect");
    return { access: r.json.access_token, refresh: r.json.refresh_token ?? t.refresh, expiresAt: exp(r.json.expires_in) };
  },
  async push(ctx, v) {
    const acct = accounts(v, ctx.mapping);
    const base = process.env.QUICKBOOKS_API_BASE ?? (process.env.QUICKBOOKS_ENV === "live" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com");
    const body = {
      TxnDate: ymd(v.date), DocNumber: v.reference.slice(0, 21), PrivateNote: v.narration.slice(0, 4000),
      Line: v.lines.map(l => ({ Description: `${l.role === "PARTY" ? v.party : l.role} ${v.reference}`.slice(0, 4000), Amount: major(l.amountMinor, v.currency), DetailType: "JournalEntryLineDetail", JournalEntryLineDetail: { PostingType: l.side === "DEBIT" ? "Debit" : "Credit", AccountRef: { value: acct(l.role) } } })),
    };
    const requestId = createHash("sha256").update(v.id).digest("hex").slice(0, 32);
    const r = await call(`${base}/v3/company/${encodeURIComponent(ctx.tenant)}/journalentry?minorversion=70&requestid=${requestId}`, { method: "POST", headers: { Authorization: `Bearer ${ctx.tokens.access}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
    checkOk(r, "QuickBooks journal entry");
    const id = r.json?.JournalEntry?.Id;
    if (!id) throw new ErpApiError(502, "QuickBooks did not return a journal entry id");
    return { externalId: String(id) };
  },
};

// ── Zoho Books ───────────────────────────────────────────────────────────────────
const zohoAcc = () => process.env.ZOHO_ACCOUNTS_URL ?? `https://accounts.zoho.${process.env.ZOHO_DC ?? "com"}`;
const zohoApi = () => process.env.ZOHO_API_BASE ?? `https://www.zohoapis.${process.env.ZOHO_DC ?? "com"}`;
export const zoho: ErpAdapter = {
  id: "ZOHO", label: "Zoho Books",
  configured: () => !!(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET),
  authUrl: (state, redirectUri) => `${zohoAcc()}/oauth/v2/auth?${form({ scope: "ZohoBooks.fullaccess.all", client_id: process.env.ZOHO_CLIENT_ID!, response_type: "code", redirect_uri: redirectUri, access_type: "offline", prompt: "consent", state })}`,
  async connect(code, redirectUri) {
    const r = await call(`${zohoAcc()}/oauth/v2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ grant_type: "authorization_code", client_id: process.env.ZOHO_CLIENT_ID!, client_secret: process.env.ZOHO_CLIENT_SECRET!, redirect_uri: redirectUri, code }) });
    checkOk(r, "Zoho token exchange");
    if (!r.json?.access_token) throw new ErpApiError(400, `Zoho token exchange failed: ${r.json?.error ?? "no token"}`);
    const orgs = await call(`${zohoApi()}/books/v3/organizations`, { headers: { Authorization: `Zoho-oauthtoken ${r.json.access_token}` } });
    checkOk(orgs, "Zoho organizations");
    const orgId = orgs.json?.organizations?.[0]?.organization_id;
    if (!orgId) throw new ErpApiError(400, "No Zoho Books organization found");
    return { tokens: { access: r.json.access_token, refresh: r.json.refresh_token, expiresAt: exp(r.json.expires_in) }, tenant: String(orgId) };
  },
  async refresh(t) {
    const r = await call(`${zohoAcc()}/oauth/v2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ grant_type: "refresh_token", client_id: process.env.ZOHO_CLIENT_ID!, client_secret: process.env.ZOHO_CLIENT_SECRET!, refresh_token: t.refresh ?? "" }) });
    if (!r.json?.access_token) throw new ErpAuthError("Zoho refresh token rejected: reconnect");
    return { access: r.json.access_token, refresh: t.refresh, expiresAt: exp(r.json.expires_in) };
  },
  async push(ctx, v) {
    const acct = accounts(v, ctx.mapping);
    const body = { journal_date: ymd(v.date), reference_number: v.reference.slice(0, 100), notes: v.narration.slice(0, 500), line_items: v.lines.map(l => ({ account_id: acct(l.role), debit_or_credit: l.side === "DEBIT" ? "debit" : "credit", amount: major(l.amountMinor, v.currency), description: `${l.role === "PARTY" ? v.party : l.role}`.slice(0, 100) })) };
    const r = await call(`${zohoApi()}/books/v3/journals?organization_id=${encodeURIComponent(ctx.tenant)}`, { method: "POST", headers: { Authorization: `Zoho-oauthtoken ${ctx.tokens.access}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    checkOk(r, "Zoho journal");
    const id = r.json?.journal?.journal_id;
    if (!id) throw new ErpApiError(502, "Zoho did not return a journal id");
    return { externalId: String(id) };
  },
};

// ── Xero ─────────────────────────────────────────────────────────────────────────
const xeroId = () => process.env.XERO_IDENTITY_URL ?? "https://identity.xero.com";
const xeroApi = () => process.env.XERO_API_BASE ?? "https://api.xero.com";
export const xero: ErpAdapter = {
  id: "XERO", label: "Xero",
  configured: () => !!(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET),
  authUrl: (state, redirectUri) => `${process.env.XERO_AUTH_URL ?? "https://login.xero.com/identity/connect/authorize"}?${form({ response_type: "code", client_id: process.env.XERO_CLIENT_ID!, redirect_uri: redirectUri, scope: "offline_access accounting.transactions", state })}`,
  async connect(code, redirectUri) {
    const r = await call(`${xeroId()}/connect/token`, { method: "POST", headers: { Authorization: basic(process.env.XERO_CLIENT_ID!, process.env.XERO_CLIENT_SECRET!), "Content-Type": "application/x-www-form-urlencoded" }, body: form({ grant_type: "authorization_code", code, redirect_uri: redirectUri }) });
    checkOk(r, "Xero token exchange");
    const conns = await call(`${xeroApi()}/connections`, { headers: { Authorization: `Bearer ${r.json.access_token}` } });
    checkOk(conns, "Xero connections");
    const tenant = conns.json?.[0]?.tenantId;
    if (!tenant) throw new ErpApiError(400, "No Xero organisation was authorised");
    return { tokens: { access: r.json.access_token, refresh: r.json.refresh_token, expiresAt: exp(r.json.expires_in) }, tenant: String(tenant) };
  },
  async refresh(t) {
    const r = await call(`${xeroId()}/connect/token`, { method: "POST", headers: { Authorization: basic(process.env.XERO_CLIENT_ID!, process.env.XERO_CLIENT_SECRET!), "Content-Type": "application/x-www-form-urlencoded" }, body: form({ grant_type: "refresh_token", refresh_token: t.refresh ?? "" }) });
    if (r.status >= 400 || !r.json?.access_token) throw new ErpAuthError("Xero refresh token rejected: reconnect");
    return { access: r.json.access_token, refresh: r.json.refresh_token ?? t.refresh, expiresAt: exp(r.json.expires_in) };
  },
  async push(ctx, v) {
    const acct = accounts(v, ctx.mapping);
    // Xero manual journals: positive LineAmount = debit, negative = credit; account CODES.
    const body = { ManualJournals: [{ Narration: v.narration.slice(0, 500), Date: ymd(v.date), Status: "POSTED", JournalLines: v.lines.map(l => ({ LineAmount: (l.side === "DEBIT" ? 1 : -1) * major(l.amountMinor, v.currency), AccountCode: acct(l.role), Description: `${l.role === "PARTY" ? v.party : l.role} ${v.reference}`.slice(0, 200) })) }] };
    const r = await call(`${xeroApi()}/api.xro/2.0/ManualJournals`, { method: "POST", headers: { Authorization: `Bearer ${ctx.tokens.access}`, "xero-tenant-id": ctx.tenant, "Idempotency-Key": createHash("sha256").update(v.id).digest("hex").slice(0, 40), "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
    checkOk(r, "Xero manual journal");
    const id = r.json?.ManualJournals?.[0]?.ManualJournalID;
    if (!id) throw new ErpApiError(502, "Xero did not return a journal id");
    return { externalId: String(id) };
  },
};

export const ADAPTERS: Record<string, ErpAdapter> = { QUICKBOOKS: quickbooks, ZOHO: zoho, XERO: xero };
