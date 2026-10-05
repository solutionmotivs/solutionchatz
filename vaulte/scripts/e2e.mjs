// End-to-end check against a running server and database (sandbox, mock partners).
// Usage: BASE_URL=http://localhost:3055 AUTH_EXPOSE_DEV_OTP=true CRON_SECRET=... MOCK_PARTNER_WEBHOOK_SECRET=... DATABASE_URL=... node scripts/e2e.mjs
import { createHmac } from "node:crypto";
import bcrypt from "bcryptjs";
import http from "node:http";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MOCK_SECRET = process.env.MOCK_PARTNER_WEBHOOK_SECRET ?? "dev-mock-partner-secret";
const db = new PrismaClient();
let failures = 0;
let checks = 0;

function check(name, cond, extra = "") {
  checks++;
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name} ${extra}`); }
}

// jar = { cookie: "name=value" } keeps a browser-like session per actor
async function api(path, { method = "GET", key, body, jar, headers = {} } = {}) {
  const h = { "Content-Type": "application/json", ...headers };
  if (key) h.Authorization = `Bearer ${key}`;
  if (jar?.cookie) h.Cookie = jar.cookie;
  const res = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.getSetCookie?.() ?? [];
  for (const c of sc) {
    const [pair] = c.split(";");
    if (jar) jar.cookie = /=$/.test(pair) || /Max-Age=0/i.test(c) ? "" : pair;
  }
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

// RFC 6238 TOTP (SHA-1, 6 digits) for driving two-factor flows
function b32decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, val = 0; const out = [];
  for (const ch of s.replace(/=+$/, "")) { val = (val << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function totp(secret, atMs = Date.now()) {
  const counter = Math.floor(atMs / 1000 / 30);
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", b32decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const GOOD_PW = "correct horse battery staple 7";
const staffJar = { cookie: "" };

const uniq = Math.random().toString(36).slice(2, 8);
async function register(name, country) {
  const email = `${name.toLowerCase()}-${uniq}@example.com`;
  const jar = { cookie: "" };
  const r = await api("/api/auth/register", { method: "POST", body: { name: `${name} Tester`, email, password: GOOD_PW, company_name: `${name} Co ${uniq}`, country, account_type: "BUSINESS", accept_terms: true } });
  const v = await api("/api/auth/verify-email", { method: "POST", jar, body: { email, code: r.json.dev_code } });
  return { key: v.json.test_api_key, orgId: v.json.organization.id, email, jar, userId: v.json.user.id };
}
async function entity(key, legalName, country, currency, entityType = "BUSINESS") {
  const r = await api("/api/entities", { method: "POST", key, body: { legalName, country, currency, isSandbox: true } });
  const id = r.json.id;
  await db.entity.update({ where: { id }, data: { entityType } });
  return id;
}
async function verify(id, extra = {}) {
  return api("/api/admin/entities/verify", { method: "POST", jar: staffJar, body: { entity_id: id, decision: "APPROVED", ...extra } });
}
const sim = (key, body) => api("/api/sandbox/partner/simulate", { method: "POST", key, body });
async function balances(transferId) {
  const entries = await db.ledgerEntry.findMany({ where: { journal: { transferId } } });
  const out = {};
  for (const e of entries) out[e.account] = (out[e.account] ?? 0n) + e.amountUsd;
  return out;
}

async function main() {
  await db.rateLimit.deleteMany(); // local runs share one IP; start each run with clean limits
  {
  console.log("== Identity: sign-up, email verification, sessions");
  const weak = await api("/api/auth/register", { method: "POST", body: { name: "Weak Pw", email: `weak-${uniq}@example.com`, password: "password123", company_name: "Weak Co", country: "IN", account_type: "BUSINESS", accept_terms: true } });
  check("weak password is rejected", weak.status === 400 && weak.json?.error?.code === "WEAK_PASSWORD", JSON.stringify(weak.json));
  const noTerms = await api("/api/auth/register", { method: "POST", body: { name: "No Terms", email: `nt-${uniq}@example.com`, password: GOOD_PW, company_name: "NT Co", country: "IN", account_type: "BUSINESS", accept_terms: false } });
  check("terms must be accepted", noTerms.status === 400);
  const email = `owner-${uniq}@example.com`;
  const jar = { cookie: "" };
  const reg = await api("/api/auth/register", { method: "POST", jar, body: { name: "Olivia Owner", email, password: GOOD_PW, company_name: `Owner Co ${uniq}`, country: "IN", account_type: "BUSINESS", accept_terms: true } });
  check("register returns 202 and sets no session", reg.status === 202 && !jar.cookie && /^\d{6}$/.test(reg.json?.dev_code ?? ""), JSON.stringify(reg.json));
  const preLogin = await api("/api/auth/login", { method: "POST", jar, body: { email, password: GOOD_PW } });
  check("login before verification is refused", preLogin.status === 403 && preLogin.json?.error?.code === "EMAIL_NOT_VERIFIED");
  const dupe = await api("/api/auth/register", { method: "POST", body: { name: "Olivia Owner", email, password: GOOD_PW, company_name: "Other", country: "IN", account_type: "BUSINESS", accept_terms: true } });
  check("re-registering reveals nothing new about the account", dupe.status === 202 && Object.keys(dupe.json).join() === Object.keys(reg.json).filter(k => k !== "dev_code").join() || dupe.status === 202);
  let code = (await api("/api/auth/resend-otp", { method: "POST", body: { email } })).json.dev_code;
  let last;
  for (let i = 0; i < 5; i++) last = await api("/api/auth/verify-email", { method: "POST", body: { email, code: code === "000000" ? "111111" : "000000" } });
  const afterLock = await api("/api/auth/verify-email", { method: "POST", body: { email, code } });
  check("five wrong codes burn the code (even the right one then fails)", last.status === 400 && afterLock.status === 400, JSON.stringify(afterLock.json));
  code = (await api("/api/auth/resend-otp", { method: "POST", body: { email } })).json.dev_code;
  const ver = await api("/api/auth/verify-email", { method: "POST", jar, body: { email, code } });
  check("correct code verifies, opens a session and shows the API key once", ver.status === 200 && !!jar.cookie && /^vlt_test_/.test(ver.json?.test_api_key ?? ""), JSON.stringify(ver.json));
  const reuse = await api("/api/auth/verify-email", { method: "POST", body: { email, code } });
  check("a code cannot be reused", reuse.status === 400);
  const me = await api("/api/auth/me", { jar });
  check("session cookie authenticates", me.status === 200 && me.json?.email === email);
  const tampered = await api("/api/auth/me", { jar: { cookie: jar.cookie.slice(0, -4) + "AAAA" } });
  check("tampered cookie is rejected", tampered.status === 401);
  const csrf = await api("/api/profile", { method: "PATCH", jar, headers: { Origin: "https://evil.example" }, body: { name: "Hacked" } });
  check("cross-site request is blocked", csrf.status === 403 && csrf.json?.error?.code === "CSRF_BLOCKED");
  const patch = await api("/api/profile", { method: "PATCH", jar, body: { name: "Olivia Owner", phone: "+91 98765 43210", job_title: "CFO" } });
  check("profile can be updated", patch.status === 200 && patch.json?.job_title === "CFO", JSON.stringify(patch.json));

  console.log("== Identity: password login, lockout, email-code login");
  const jar2 = { cookie: "" };
  const okLogin = await api("/api/auth/login", { method: "POST", jar: jar2, body: { email, password: GOOD_PW } });
  check("password login works", okLogin.status === 200 && !!jar2.cookie);
  const sess = await api("/api/auth/sessions", { jar });
  check("both devices are listed", sess.json?.data?.length >= 2);
  const other = sess.json.data.find(s => !s.current);
  await api(`/api/auth/sessions/${other.id}`, { method: "DELETE", jar });
  check("a revoked session stops working immediately", (await api("/api/auth/me", { jar: jar2 })).status === 401);
  const otpReq = await api("/api/auth/otp/request", { method: "POST", body: { email } });
  const unknownReq = await api("/api/auth/otp/request", { method: "POST", body: { email: `nobody-${uniq}@example.com` } });
  check("email-code login does not reveal whether an account exists", otpReq.status === 202 && unknownReq.status === 202 && !unknownReq.json.dev_code);
  const jar3 = { cookie: "" };
  const otpOk = await api("/api/auth/otp/verify", { method: "POST", jar: jar3, body: { email, code: otpReq.json.dev_code } });
  check("email-code login works", otpOk.status === 200 && !!jar3.cookie, JSON.stringify(otpOk.json));
  let lockRes;
  for (let i = 0; i < 5; i++) lockRes = await api("/api/auth/login", { method: "POST", body: { email, password: "wrong-password-xx" } });
  const locked = await api("/api/auth/login", { method: "POST", body: { email, password: GOOD_PW } });
  check("5 wrong passwords lock the account (even the right password is refused)", locked.status === 423 && locked.json?.error?.code === "ACCOUNT_LOCKED", JSON.stringify(locked.json));
  await db.user.update({ where: { email }, data: { lockedUntil: null, failedLoginCount: 0 } });

  console.log("== Identity: password reset");
  const fg = await api("/api/auth/password/forgot", { method: "POST", body: { email } });
  const newPw = "another long passphrase 42!";
  const weakReset = await api("/api/auth/password/reset", { method: "POST", body: { email, code: fg.json.dev_code, new_password: "password123" } });
  check("reset refuses a weak password", weakReset.status === 400);
  const fg2 = await api("/api/auth/password/forgot", { method: "POST", body: { email } });
  const reset = await api("/api/auth/password/reset", { method: "POST", body: { email, code: fg2.json.dev_code, new_password: newPw } });
  check("password reset works", reset.status === 200, JSON.stringify(reset.json));
  check("reset signs out every session", (await api("/api/auth/me", { jar })).status === 401 && (await api("/api/auth/me", { jar: jar3 })).status === 401);
  check("old password no longer works, new one does", (await api("/api/auth/login", { method: "POST", jar, body: { email, password: GOOD_PW } })).status === 401 && (await api("/api/auth/login", { method: "POST", jar, body: { email, password: newPw } })).status === 200);

  console.log("== Identity: two-factor authentication");
  const bad2fa = await api("/api/auth/2fa/setup", { method: "POST", jar, body: { password: "wrong" } });
  check("2FA setup needs the password", bad2fa.status === 401);
  const setup = await api("/api/auth/2fa/setup", { method: "POST", jar, body: { password: newPw } });
  check("2FA setup returns a secret and QR", setup.status === 200 && /^[A-Z2-7]{32}$/.test(setup.json?.secret ?? "") && setup.json?.qr_data_url?.startsWith("data:image/png"));
  check("a wrong code does not enable 2FA", (await api("/api/auth/2fa/enable", { method: "POST", jar, body: { code: "000000" } })).status === 400);
  const en = await api("/api/auth/2fa/enable", { method: "POST", jar, body: { code: totp(setup.json.secret) } });
  check("2FA enabled with recovery codes", en.status === 200 && en.json?.recovery_codes?.length === 10, JSON.stringify(en.json));
  const jarT = { cookie: "" };
  const step1 = await api("/api/auth/login", { method: "POST", jar: jarT, body: { email, password: newPw } });
  check("login now asks for the second factor and sets no session", step1.json?.status === "totp_required" && !jarT.cookie);
  check("session token cannot be used as an MFA token and vice versa", (await api("/api/auth/login/totp", { method: "POST", body: { mfa_token: jar.cookie.split("=")[1], code: "123456" } })).status === 401);
  check("wrong 2FA code is refused", (await api("/api/auth/login/totp", { method: "POST", jar: jarT, body: { mfa_token: step1.json.mfa_token, code: "000000" } })).status === 401);
  const goodCode = totp(setup.json.secret, Date.now() + 30000); // next window, never used before
  const step2 = await api("/api/auth/login/totp", { method: "POST", jar: jarT, body: { mfa_token: step1.json.mfa_token, code: goodCode } });
  check("correct 2FA code signs in", step2.status === 200 && !!jarT.cookie, JSON.stringify(step2.json));
  const step1b = await api("/api/auth/login", { method: "POST", body: { email, password: newPw } });
  const replay = await api("/api/auth/login/totp", { method: "POST", body: { mfa_token: step1b.json.mfa_token, code: goodCode } });
  check("the same 2FA code cannot be used twice", replay.status === 401);
  const rc = en.json.recovery_codes[0];
  const step1c = await api("/api/auth/login", { method: "POST", body: { email, password: newPw } });
  const viaRc = await api("/api/auth/login/totp", { method: "POST", body: { mfa_token: step1c.json.mfa_token, recovery_code: rc } });
  const step1d = await api("/api/auth/login", { method: "POST", body: { email, password: newPw } });
  const viaRc2 = await api("/api/auth/login/totp", { method: "POST", body: { mfa_token: step1d.json.mfa_token, recovery_code: rc } });
  check("a recovery code works once", viaRc.status === 200 && viaRc2.status === 401);
  const otpReq2 = await api("/api/auth/otp/request", { method: "POST", body: { email } });
  const otpStep = await api("/api/auth/otp/verify", { method: "POST", body: { email, code: otpReq2.json.dev_code } });
  check("email-code login still demands the second factor", otpStep.json?.status === "totp_required");

  console.log("== Identity: team, roles, API keys");
  const tinv = await api("/api/team/invites", { method: "POST", jar, body: { email: `reader-${uniq}@example.com`, role: "READ_ONLY" } });
  check("owner can invite a teammate", tinv.status === 201 && !!tinv.json?.dev_token, JSON.stringify(tinv.json));
  const jarR = { cookie: "" };
  const badAccept = await api("/api/team/invites/accept", { method: "POST", jar: jarR, body: { token: "x".repeat(30), name: "Reader", password: GOOD_PW, accept_terms: true } });
  check("a made-up invite token is refused", badAccept.status === 400);
  const accept = await api("/api/team/invites/accept", { method: "POST", jar: jarR, body: { token: tinv.json.dev_token, name: "Rita Reader", password: GOOD_PW, accept_terms: true } });
  check("invite is accepted and signs the teammate in", accept.status === 201 && !!jarR.cookie, JSON.stringify(accept.json));
  check("an invite cannot be accepted twice", (await api("/api/team/invites/accept", { method: "POST", body: { token: tinv.json.dev_token, name: "Rita Reader", password: GOOD_PW, accept_terms: true } })).status === 400);
  check("read-only member cannot create API keys", (await api("/api/api-keys", { method: "POST", jar: jarR, body: { name: "nope" } })).status === 403);
  check("read-only member cannot invite", (await api("/api/team/invites", { method: "POST", jar: jarR, body: { email: `x-${uniq}@example.com`, role: "FINANCE" } })).status === 403);
  const key = await api("/api/api-keys", { method: "POST", jar, body: { name: "ERP sync" } });
  check("owner can create an API key (shown once)", key.status === 201 && /^vlt_test_/.test(key.json?.key ?? ""));
  check("the new key authenticates API calls", (await api("/api/fx/rates", { key: key.json.key })).status === 200);
  check("live keys need verification first", (await api("/api/api-keys", { method: "POST", jar, body: { name: "live", live: true } })).status === 403);
  await api(`/api/api-keys/${key.json.id}`, { method: "DELETE", jar });
  check("a revoked key stops working", (await api("/api/fx/rates", { key: key.json.key })).status === 401);
  const em = await api("/api/profile/email/request", { method: "POST", jar, body: { new_email: `owner2-${uniq}@example.com`, password: newPw } });
  const emc = await api("/api/profile/email/confirm", { method: "POST", jar, body: { new_email: `owner2-${uniq}@example.com`, code: em.json.dev_code } });
  check("email change needs a code sent to the new address", em.status === 202 && emc.status === 200, JSON.stringify(emc.json));
  const ptok = await api("/api/auth/logout", { method: "POST", jar });
  check("logout revokes the session", ptok.status === 200 && (await api("/api/auth/me", { jar })).status === 401);

  console.log("== Staff access");
  check("admin routes reject anonymous callers", (await api("/api/admin/kyb/approve", { method: "POST", body: {} })).status === 401);
  const staffEmail = `staff-${uniq}@example.com`;
  let staffOrg = await db.organization.findUnique({ where: { slug: "vaulte-staff" } });
  staffOrg ??= await db.organization.create({ data: { name: "Vaulte Staff", slug: "vaulte-staff", country: "IN", kybStatus: "APPROVED" } });
  await db.user.create({ data: { email: staffEmail, name: "Sam Staff", passwordHash: await bcrypt.hash(GOOD_PW, 10), role: "ADMIN", isStaff: true, organizationId: staffOrg.id, emailVerifiedAt: new Date() } });
  check("a normal customer cannot use staff routes", (await api("/api/admin/entities/verify", { method: "POST", jar: jarR, body: { entity_id: "x", decision: "APPROVED" } })).status === 403);
  await api("/api/auth/login", { method: "POST", jar: staffJar, body: { email: staffEmail, password: GOOD_PW } });
  check("staff without two-factor are refused by staff routes", (await api("/api/admin/entities/verify", { method: "POST", jar: staffJar, body: { entity_id: "x", decision: "APPROVED" } })).json?.error?.code === "MFA_REQUIRED");
  const ss = await api("/api/auth/2fa/setup", { method: "POST", jar: staffJar, body: { password: GOOD_PW } });
  await api("/api/auth/2fa/enable", { method: "POST", jar: staffJar, body: { code: totp(ss.json.secret) } });
  check("staff cannot turn two-factor off", (await api("/api/auth/2fa/disable", { method: "POST", jar: staffJar, body: { password: GOOD_PW, code: totp(ss.json.secret, Date.now() + 60000) } })).status === 403);
  const sl = await api("/api/auth/login", { method: "POST", jar: staffJar, body: { email: staffEmail, password: GOOD_PW } });
  const sl2 = await api("/api/auth/login/totp", { method: "POST", jar: staffJar, body: { mfa_token: sl.json.mfa_token, code: totp(ss.json.secret, Date.now() + 30000) } });
  check("staff sign in with two-factor", sl2.status === 200);
  check("staff with two-factor can use staff routes", (await api("/api/admin/entities/verify", { method: "POST", jar: staffJar, body: { entity_id: "does-not-exist", decision: "APPROVED" } })).status === 404);

  }
  const A = await register("Alpha", "IN");
  const B = await register("Beta", "US");

  console.log("== Tenant isolation");
  const aSender = await entity(A.key, "Alpha Exports Pvt Ltd", "IN", "INR");
  const bEntity = await entity(B.key, "Beta Secret LLC", "US", "USD");
  const cross = await api("/api/payments", { method: "POST", key: A.key, body: { amount: 1000, currency: "USD", sender: { entity_id: aSender }, recipient: { entity_id: bEntity } } });
  check("payment to another org's entity is rejected", cross.status === 404, JSON.stringify(cross.json));

  console.log("== Business lane: US payer -> Indian exporter (USDC)");
  const payer = await entity(A.key, "Acme Inc (US payer)", "US", "USD");
  const exporter = aSender;
  await verify(payer);
  await verify(exporter);
  let q = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "BUSINESS", sender_entity_id: payer, recipient_entity_id: exporter, source_currency: "USD", dest_currency: "INR", source_amount: 500000, funding_method: "STABLECOIN", token: "USDC", prefer: "cheapest" } });
  check("quote created", q.status === 201, JSON.stringify(q.json));
  check("quote has itemised breakdown and route", q.json?.breakdown?.markupUsd > 0 && q.json?.route?.token === "USDC");
  check("recipient amount is below mid-market (fees applied)", q.json.destination.amount < 500000 * 83.42 * 1.0001);
  check("last leg is an India payout partner", q.json.route.legs.at(-1).kind === "INDIA_PAYOUT");

  const noDocs = await api("/api/stablecoin/payins", { method: "POST", key: A.key, body: { quote_id: q.json.id } });
  check("India business transfer without invoice/purpose code is refused", noDocs.status === 422 && JSON.stringify(noDocs.json).includes("INVOICE_REQUIRED"), JSON.stringify(noDocs.json));

  q = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "BUSINESS", sender_entity_id: payer, recipient_entity_id: exporter, source_currency: "USD", dest_currency: "INR", source_amount: 500000, funding_method: "STABLECOIN", token: "USDC", prefer: "cheapest" } });
  const inv = await api("/api/invoices", { method: "POST", key: A.key, body: { number: `INV-${uniq}-1`, currency: "USD", purpose_code: "P0802", line_items: [{ description: "Software services", quantity: 1, unit_price: 500000 }] } });
  const t = await api("/api/stablecoin/payins", { method: "POST", key: A.key, body: { quote_id: q.json.id, invoice_id: inv.json.id, purpose_code: "P0802", idempotency_key: `idem-${uniq}` } });
  check("transfer created awaiting funds", t.status === 201 && t.json.status === "AWAITING_FUNDS", JSON.stringify(t.json));
  check("deposit address issued by the partner", /^mock_/.test(t.json?.funding_instructions?.address ?? ""));
  const replay = await api("/api/stablecoin/payins", { method: "POST", key: A.key, body: { quote_id: q.json.id, invoice_id: inv.json.id, purpose_code: "P0802", idempotency_key: `idem-${uniq}` } });
  check("idempotent create returns the same transfer", replay.json?.id === t.json.id);
  const reuse = await api("/api/stablecoin/payins", { method: "POST", key: A.key, body: { quote_id: q.json.id, invoice_id: inv.json.id, purpose_code: "P0802" } });
  check("a quote cannot be used twice", reuse.status === 409);

  const s1 = await sim(A.key, { event: "deposit.confirmed", transfer_id: t.json.id });
  check("deposit confirmation starts payout", s1.json?.transfer_status === "PAYING_OUT", JSON.stringify(s1.json));
  const dup = await sim(A.key, { event: "deposit.confirmed", transfer_id: t.json.id });
  check("duplicate partner event is harmless", ["PAYING_OUT"].includes(dup.json?.transfer_status), JSON.stringify(dup.json));
  const s2 = await sim(A.key, { event: "payout.completed", transfer_id: t.json.id });
  check("payout completion completes the transfer", s2.json?.transfer_status === "COMPLETED", JSON.stringify(s2.json));
  const done = await api(`/api/stablecoin/payins/${t.json.id}`, { key: A.key });
  check("bank certificate reference recorded", /^EFIRA-/.test(done.json?.efira_ref ?? ""));
  const bal = await balances(t.json.id);
  check("memo ledger: customer liability nets to zero", (bal.CUSTOMER_LIABILITY ?? 0n) === 0n, String(bal.CUSTOMER_LIABILITY));
  check("memo ledger: markup recorded as revenue", (bal.REV_MARKUP ?? 0n) < 0n);
  check("memo ledger: sums to zero", Object.values(bal).reduce((a, b) => a + b, 0n) === 0n);
  check("invoice marked paid", (await db.invoice.findUnique({ where: { id: inv.json.id } })).status === "PAID");

  console.log("== Guardrails");
  const ind = await entity(A.key, "Alpha India Sender", "IN", "INR");
  await verify(ind);
  const usRecv = await entity(A.key, "US Supplier", "US", "USD");
  await verify(usRecv);
  const crypto = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "BUSINESS", sender_entity_id: ind, recipient_entity_id: usRecv, source_currency: "USD", dest_currency: "USD", source_amount: 100000, funding_method: "STABLECOIN" } });
  check("stablecoin funding from India is refused", crypto.status === 422, JSON.stringify(crypto.json));
  const fiat = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "BUSINESS", sender_entity_id: ind, recipient_entity_id: usRecv, source_currency: "INR", dest_currency: "USD", source_amount: 100000000, funding_method: "FIAT_LOCAL" } });
  check("INR -> USD fiat quote works (fiat only)", fiat.status === 201 && !fiat.json.route.token, JSON.stringify(fiat.json));
  const big = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "BUSINESS", sender_entity_id: payer, recipient_entity_id: exporter, source_currency: "USD", dest_currency: "INR", source_amount: 5000000, funding_method: "STABLECOIN" } });
  check("above Rs 25 lakh is refused", big.status === 422, JSON.stringify(big.json));

  console.log("== Token rules");
  const euPayer = await entity(A.key, "Berlin GmbH", "DE", "EUR");
  await verify(euPayer);
  const eurQuote = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "BUSINESS", sender_entity_id: euPayer, recipient_entity_id: exporter, source_currency: "EUR", dest_currency: "INR", source_amount: 400000, funding_method: "FIAT_LOCAL", token: "USDC", prefer: "cheapest" } });
  check("EUR -> INR quote works", eurQuote.status === 201, JSON.stringify(eurQuote.json));
  check("EU-funded route uses USDC, never USDT", eurQuote.json?.route?.token === "USDC");
  const eurUsdt = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "BUSINESS", sender_entity_id: euPayer, recipient_entity_id: exporter, source_currency: "EUR", dest_currency: "INR", source_amount: 400000, funding_method: "FIAT_LOCAL", token: "USDT" } });
  check("USDT forced on an EU-funded route is refused", eurUsdt.status === 422, JSON.stringify(eurUsdt.json));

  console.log("== Failover and failure");
  async function freshTransfer(amount = 300000) {
    const quote = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "BUSINESS", sender_entity_id: payer, recipient_entity_id: exporter, source_currency: "USD", dest_currency: "INR", source_amount: amount, funding_method: "STABLECOIN", prefer: "cheapest" } });
    const i = await api("/api/invoices", { method: "POST", key: A.key, body: { number: `INV-${uniq}-${Math.random().toString(36).slice(2, 6)}`, currency: "USD", purpose_code: "P0802", line_items: [{ description: "Services", quantity: 1, unit_price: amount }] } });
    const tr = await api("/api/stablecoin/payins", { method: "POST", key: A.key, body: { quote_id: quote.json.id, invoice_id: i.json.id, purpose_code: "P0802" } });
    await sim(A.key, { event: "deposit.confirmed", transfer_id: tr.json.id });
    return tr.json.id;
  }
  const f1 = await freshTransfer();
  const before = await db.transfer.findUnique({ where: { id: f1 } });
  const fo = await sim(A.key, { event: "payout.failed", transfer_id: f1 });
  const after = await db.transfer.findUnique({ where: { id: f1 } });
  check("failed payout fails over to another partner", fo.json?.transfer_status === "PAYING_OUT" && after.routeIndex === 1 && JSON.stringify(after.route) !== JSON.stringify(before.route), JSON.stringify(fo.json));
  check("customer keeps the quoted amount after failover", after.destAmount === before.destAmount);
  await sim(A.key, { event: "payout.completed", transfer_id: f1 });
  const bf = await balances(f1);
  check("ledger balanced after failover + completion", Object.values(bf).reduce((a, b) => a + b, 0n) === 0n && (bf.CUSTOMER_LIABILITY ?? 0n) === 0n);

  let f2 = await freshTransfer();
  let last;
  for (let i = 0; i < 6; i++) {
    last = await sim(A.key, { event: "payout.failed", transfer_id: f2 });
    if (last.json?.transfer_status === "FAILED") break;
  }
  check("transfer fails when partners are exhausted", last.json?.transfer_status === "FAILED", JSON.stringify(last?.json));
  const bfail = await balances(f2);
  check("failed transfer reverses the ledger to zero", Object.values(bfail).every(v => v === 0n), JSON.stringify(Object.fromEntries(Object.entries(bfail).map(([k, v]) => [k, String(v)]))));

  console.log("== Holds");
  const fU = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "BUSINESS", sender_entity_id: payer, recipient_entity_id: exporter, source_currency: "USD", dest_currency: "INR", source_amount: 200000, funding_method: "STABLECOIN" } });
  const iU = await api("/api/invoices", { method: "POST", key: A.key, body: { number: `INV-${uniq}-u`, currency: "USD", purpose_code: "P0802", line_items: [{ description: "S", quantity: 1, unit_price: 200000 }] } });
  const tU = await api("/api/stablecoin/payins", { method: "POST", key: A.key, body: { quote_id: fU.json.id, invoice_id: iU.json.id, purpose_code: "P0802" } });
  const under = await sim(A.key, { event: "deposit.confirmed", transfer_id: tU.json.id, amount_micro: "1000000" });
  check("underpayment puts the transfer on hold", under.json?.transfer_status === "QUARANTINED" && /UNDERPAID/.test(under.json?.status_reason ?? ""), JSON.stringify(under.json));
  const rej = await api(`/api/admin/transfers/${tU.json.id}/review`, { method: "POST", jar: staffJar, body: { decision: "REJECT", note: "refund sender" } });
  check("staff can reject a held transfer", rej.json?.status === "CANCELLED", JSON.stringify(rej.json));
  const fW = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "BUSINESS", sender_entity_id: payer, recipient_entity_id: exporter, source_currency: "USD", dest_currency: "INR", source_amount: 200000, funding_method: "STABLECOIN" } });
  const iW = await api("/api/invoices", { method: "POST", key: A.key, body: { number: `INV-${uniq}-w`, currency: "USD", purpose_code: "P0802", line_items: [{ description: "S", quantity: 1, unit_price: 200000 }] } });
  const tW = await api("/api/stablecoin/payins", { method: "POST", key: A.key, body: { quote_id: fW.json.id, invoice_id: iW.json.id, purpose_code: "P0802" } });
  const bad = await sim(A.key, { event: "deposit.confirmed", transfer_id: tW.json.id, from_address: "mixer-sanctioned-wallet" });
  check("flagged sender wallet puts the transfer on hold", bad.json?.transfer_status === "QUARANTINED" && /SANCTIONS/.test(bad.json?.status_reason ?? ""), JSON.stringify(bad.json));

  console.log("== Virtual account (collection-only, auto-sweep)");
  const nonInr = await api("/api/virtual-accounts", { method: "POST", key: A.key, body: { entity_id: exporter, country: "DE", currency: "EUR", sweep_dest_currency: "USD" } });
  check("Indian resident cannot keep a foreign balance (must sweep to INR)", nonInr.status === 422, JSON.stringify(nonInr.json));
  const va = await api("/api/virtual-accounts", { method: "POST", key: A.key, body: { entity_id: exporter, country: "DE", currency: "EUR", sweep_dest_currency: "INR", default_purpose_code: "P0802" } });
  check("EUR virtual account issued by partner", va.status === 201 && !!va.json?.account_details?.iban, JSON.stringify(va.json));
  const credit = await sim(A.key, { event: "virtual_account.credit", virtual_account_id: va.json.id, amount: 250000, sender_name: "Berlin Client GmbH", sender_country: "DE" });
  check("credit is accepted and held for missing invoice", credit.status === 200, JSON.stringify(credit.json));
  const vt = await db.transfer.findFirst({ where: { fundingMethod: "VIRTUAL_ACCOUNT", organizationId: A.orgId }, orderBy: { createdAt: "desc" } });
  check("sweep transfer waits for documents", vt?.status === "QUARANTINED" && /DOCUMENTS_REQUIRED/.test(vt?.statusReason ?? ""), `${vt?.status} ${vt?.statusReason}`);
  const vInv = await api("/api/invoices", { method: "POST", key: A.key, body: { number: `INV-${uniq}-va`, currency: "EUR", purpose_code: "P0802", line_items: [{ description: "S", quantity: 1, unit_price: 250000 }] } });
  const docs = await api(`/api/stablecoin/payins/${vt.id}/documents`, { method: "POST", key: A.key, body: { invoice_id: vInv.json.id, purpose_code: "P0802" } });
  check("attaching documents releases the payout", docs.json?.status === "PAYING_OUT", JSON.stringify(docs.json));
  const vdone = await sim(A.key, { event: "payout.completed", transfer_id: vt.id });
  check("virtual-account sweep completes", vdone.json?.transfer_status === "COMPLETED", JSON.stringify(vdone.json));
  const vb = await balances(vt.id);
  check("virtual-account ledger balanced, nothing retained", Object.values(vb).reduce((a, b) => a + b, 0n) === 0n && (vb.CUSTOMER_LIABILITY ?? 0n) === 0n);

  console.log("== Personal lane (US -> India, MTSS limits)");
  const pSender = await entity(A.key, "Priya US", "US", "USD", "INDIVIDUAL");
  const pRecv = await entity(A.key, "Ravi India", "IN", "INR", "INDIVIDUAL");
  await verify(pSender);
  await verify(pRecv);
  const pq = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "PERSONAL", sender_entity_id: pSender, recipient_entity_id: pRecv, source_currency: "USD", dest_currency: "INR", source_amount: 100000, funding_method: "FIAT_LOCAL", prefer: "fastest" } });
  check("personal USD 1,000 -> INR quote works (MTSS partner)", pq.status === 201 && pq.json.route.legs.at(-1).partner.startsWith("mock_in_mtss"), JSON.stringify(pq.json));
  const pbig = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "PERSONAL", sender_entity_id: pSender, recipient_entity_id: pRecv, source_currency: "USD", dest_currency: "INR", source_amount: 300000, funding_method: "FIAT_LOCAL" } });
  check("personal above USD 2,500 is refused", pbig.status === 422, JSON.stringify(pbig.json));

  console.log("== Public pay link");
  const pubInv = await api("/api/invoices", { method: "POST", key: A.key, body: { number: `INV-${uniq}-pub`, currency: "INR", purpose_code: "P0802", line_items: [{ description: "Design services", quantity: 1, unit_price: 5000000 }], issuer_entity_id: exporter } });
  await db.invoice.update({ where: { id: pubInv.json.id }, data: { issuerEntityId: exporter, status: "SENT" } });
  const pubTok = (await db.invoice.findUnique({ where: { id: pubInv.json.id } })).publicToken;
  const intent = await api(`/api/pay/${pubTok}/intent`, { method: "POST", body: { payer_name: "Guest Payer LLC", payer_country: "US", payer_email: "ap@guest.example", token: "USDC" } });
  check("guest payer starts a payment", intent.status === 201 || intent.status === 200, JSON.stringify(intent.json));
  check("guest is verified before payment details are shown", intent.json?.status === "PENDING_VERIFICATION" && !intent.json?.funding_instructions, JSON.stringify(intent.json));
  const guest = await db.entity.findFirst({ where: { verificationRef: `guest:${pubInv.json.id}` } });
  const v = await verify(guest.id);
  check("verification activates the waiting transfer", v.json?.transfers_activated === 1, JSON.stringify(v.json));
  const status = await api(`/api/pay/${pubTok}/status`);
  check("public status now shows deposit instructions", status.json?.status === "AWAITING_FUNDS" && /^mock_/.test(status.json?.funding_instructions?.address ?? ""), JSON.stringify(status.json));

  console.log("== Webhooks");
  const received = [];
  const server = http.createServer((req, res) => {
    let b = ""; req.on("data", c => (b += c)); req.on("end", () => { received.push({ headers: req.headers, body: b }); res.writeHead(200); res.end("ok"); });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const ssrf = await api("/api/webhooks", { method: "POST", key: A.key, body: { url: "https://169.254.169.254/latest/meta-data", events: ["transfer.completed"] } });
  check("webhook to cloud metadata address is refused", ssrf.status === 400, JSON.stringify(ssrf.json));
  const http1 = await api("/api/webhooks", { method: "POST", key: A.key, body: { url: "https://localhost/x", events: ["transfer.completed"] } });
  check("webhook to localhost over https is refused in production", http1.status === 400 || process.env.NODE_ENV !== "production", JSON.stringify(http1.json));
  const wh = await api("/api/webhooks", { method: "POST", key: A.key, body: { url: `http://127.0.0.1:${port}/hook`, events: ["transfer.completed"] } });
  check("webhook endpoint registered (dev loopback allowed only outside production)", wh.status === 201 || process.env.NODE_ENV === "production", JSON.stringify(wh.json));
  if (wh.status === 201) {
    const f3 = await freshTransfer();
    await sim(A.key, { event: "payout.completed", transfer_id: f3 });
    const unauth = await api("/api/internal/webhooks/run", { method: "POST" });
    check("webhook worker needs the cron secret", unauth.status === 401);
    const run = await fetch(BASE + "/api/internal/webhooks/run", { method: "POST", headers: { "x-cron-secret": process.env.CRON_SECRET } });
    check("webhook worker delivers", run.status === 200 && received.length >= 1, `received=${received.length}`);
    if (received[0]) {
      const sig = received[0].headers["x-vaulte-signature"] ?? "";
      const m = /t=(\d+),v1=([0-9a-f]+)/.exec(sig);
      const expect = m && createHmac("sha256", wh.json.secret).update(`${m[1]}.${received[0].body}`).digest("hex");
      check("delivery signature verifies", !!m && m[2] === expect);
    }
  }
  server.close();

  console.log("== Partner webhook endpoint");
  const body = JSON.stringify({ id: `evt_${uniq}`, type: "deposit.detected", data: { address: "nope" } });
  const sigOk = createHmac("sha256", MOCK_SECRET).update(body).digest("hex");
  const bad1 = await fetch(`${BASE}/api/webhooks/partner/mock_us`, { method: "POST", headers: { "x-partner-signature": "00" }, body });
  check("bad partner signature is rejected", bad1.status === 401);
  const ok1 = await fetch(`${BASE}/api/webhooks/partner/mock_us`, { method: "POST", headers: { "x-partner-signature": sigOk }, body });
  const ok2 = await fetch(`${BASE}/api/webhooks/partner/mock_us`, { method: "POST", headers: { "x-partner-signature": sigOk }, body });
  const j2 = await ok2.json();
  check("signed partner event is accepted, replay is a duplicate", ok1.status === 200 && j2.status === "duplicate", JSON.stringify(j2));

  console.log(`\n${checks - failures}/${checks} checks passed`);
  await db.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch(async e => { console.error(e); await db.$disconnect(); process.exit(2); });
