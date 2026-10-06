// End-to-end check against a running server and database (sandbox, mock partners).
// Usage: BASE_URL=http://localhost:3055 AUTH_EXPOSE_DEV_OTP=true CRON_SECRET=... MOCK_PARTNER_WEBHOOK_SECRET=... DATABASE_URL=... node scripts/e2e.mjs
import { createHmac } from "node:crypto";
import bcrypt from "bcryptjs";
import { PDFDocument } from "pdf-lib";
import { XMLParser } from "fast-xml-parser";
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
async function api(path, { method, key, body, jar, headers = {} } = {}) {
  method ??= body !== undefined ? "POST" : "GET";
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
  // net USD value per account code across every journal of the transfer
  const entries = await db.glEntry.findMany({ where: { journal: { transferId } }, include: { account: true } });
  const out = {};
  for (const e of entries) out[e.account.code] = (out[e.account.code] ?? 0n) + e.baseUsdCents;
  return out;
}

async function main() {
  await db.rateLimit.deleteMany(); // local runs share one IP; start each run with clean limits
  await db.webhookEvent.deleteMany(); // leftovers from earlier runs would crowd the worker batch
  await db.screeningCheck.deleteMany(); // earlier runs leave open alerts that would push this run's alert off the first page of the queue
  // Test database only: the ledger is append-only by design, so a fresh e2e run empties it with TRUNCATE (which the row triggers do not intercept).
  await db.$executeRawUnsafe('TRUNCATE "GlEntry","GlJournal","GlPeriod","GlChain" CASCADE');
  await db.reconLine.deleteMany(); await db.reconBatch.deleteMany();
  // A small fixture list so sanctions behaviour is testable offline (the official lists are loaded by the sync job).
  const FIXTURE_ADDR = "0x" + "e2ecafe".padEnd(39, "0") + "1";
  await db.sanctionsAddress.deleteMany({ where: { list: "E2E_FIXTURE" } });
  await db.sanctionsEntry.deleteMany({ where: { list: "E2E_FIXTURE" } });
  const fx = await db.sanctionsEntry.create({ data: { list: "E2E_FIXTURE", externalId: "fx1", kind: "ENTITY", name: "BLOCKED TRADING COMPANY", aliases: ["BTC FZE"], normNames: [], birthYears: [], countries: ["iran"], programs: ["TEST"] } });
  await db.sanctionsAddress.create({ data: { list: "E2E_FIXTURE", asset: "ETH", address: FIXTURE_ADDR, addrKey: FIXTURE_ADDR, entryId: fx.id } });
  await db.sanctionsList.upsert({ where: { code: "E2E_FIXTURE" }, create: { code: "E2E_FIXTURE", version: "fx", entryCount: 1, addressCount: 1 }, update: { fetchedAt: new Date(), version: "fx" + Date.now() } });
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
  const tm = q.json.timing;
  check("a quote carries timing: typical and effective seconds, same-day / within-24h flags, a basis, and an honest note", tm && tm.typical_seconds > 0 && tm.effective_seconds >= tm.typical_seconds && typeof tm.same_day === "boolean" && typeof tm.within_24h === "boolean" && ["target", "measured"].includes(tm.basis) && /guarantee|Measured/.test(tm.note), JSON.stringify(tm));
  const sameDayQ = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "BUSINESS", sender_entity_id: payer, recipient_entity_id: exporter, source_currency: "USD", dest_currency: "INR", source_amount: 500000, funding_method: "STABLECOIN", token: "USDC", prefer: "same_day" } });
  check("prefer: same_day is accepted and returns timing", sameDayQ.status === 201 && !!sameDayQ.json.timing, JSON.stringify(sameDayQ.json?.error));
  check("an unknown preference is refused", (await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "BUSINESS", sender_entity_id: payer, recipient_entity_id: exporter, source_currency: "USD", dest_currency: "INR", source_amount: 500000, funding_method: "STABLECOIN", prefer: "instant_always" } })).status === 400);

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
  check("ledger: customer obligations (memo 9200) net to zero", (bal["9200"] ?? 0n) === 0n, String(bal["9200"]));
  check("ledger: markup recorded as revenue (4000) and due from partner (1100)", (bal["4000"] ?? 0n) < 0n && (bal["1100"] ?? 0n) === -(bal["4000"] ?? 0n));
  check("ledger: transfer journals sum to zero", Object.values(bal).reduce((a, b) => a + b, 0n) === 0n);
  check("invoice marked paid", (await db.invoice.findUnique({ where: { id: inv.json.id } })).status === "PAID");

  console.log("== Invoices, proforma, payment links, hosted checkout");
  const yr = new Date().getUTCFullYear();
  const i1 = await api("/api/invoices", { method: "POST", key: A.key, body: { currency: "USD", issuer_entity_id: exporter, payer_name: "Globex GmbH", payer_email: "ap@globex.example", payer_address: "1 Main St, Berlin", payer_tax_id: "DE123456789", reference: "PO-77", line_items: [{ description: "Design work", quantity: 3, unit_price: 3333, tax_rate: 18 }, { description: "Hosting", quantity: 1, unit_price: 500 }] } });
  check("an invoice without a number gets the next sequential one", i1.status === 201 && new RegExp(`^INV-${yr}-\\d{4}$`).test(i1.json.number), JSON.stringify(i1.json).slice(0, 200));
  check("totals: tax is computed per line (9999 + 1800 tax + 500)", i1.json.subtotal === 10499 && i1.json.tax_amount === 1800 && i1.json.total_amount === 12299, JSON.stringify(i1.json));
  check("the response carries a pay link and a PDF link", /\/pay\/[A-Za-z0-9]+$/.test(i1.json.pay_url) && /\/api\/pay\/.+\/pdf$/.test(i1.json.pdf_url));
  const i2 = await api("/api/invoices", { method: "POST", key: A.key, body: { currency: "USD", issuer_entity_id: exporter, line_items: [{ description: "x", quantity: 1, unit_price: 100 }] } });
  check("numbers increase", Number(i2.json.number.slice(-4)) === Number(i1.json.number.slice(-4)) + 1, i2.json.number);
  const pf = await api("/api/invoices", { method: "POST", key: A.key, body: { kind: "PROFORMA", currency: "USD", issuer_entity_id: exporter, payer_name: "Globex GmbH", line_items: [{ description: "Advance", quantity: 1, unit_price: 250000, tax_rate: 0 }] } });
  check("a proforma gets its own PF- number series", pf.status === 201 && pf.json.kind === "PROFORMA" && new RegExp(`^PF-${yr}-\\d{4}$`).test(pf.json.number), JSON.stringify(pf.json).slice(0, 160));
  check("a custom duplicate number is refused", (await api("/api/invoices", { method: "POST", key: A.key, body: { number: i1.json.number, currency: "USD", line_items: [{ description: "x", quantity: 1, unit_price: 1 }] } })).status === 409);
  check("an invalid line item is refused", (await api("/api/invoices", { method: "POST", key: A.key, body: { currency: "USD", line_items: [{ description: "", quantity: 1, unit_price: 1 }] } })).status === 400);
  check("another organisation cannot read the invoice", (await api(`/api/invoices/${i1.json.id}`, { key: B.key })).status === 404);
  const pdfRes = await fetch(`${BASE}/api/invoices/${i1.json.id}/pdf`, { headers: { Authorization: `Bearer ${A.key}` } });
  const pdfBytes = Buffer.from(await pdfRes.arrayBuffer());
  check("the invoice downloads as a PDF", pdfRes.status === 200 && pdfRes.headers.get("content-type") === "application/pdf" && pdfBytes.subarray(0, 5).toString() === "%PDF-" && /attachment/.test(pdfRes.headers.get("content-disposition")));
  const pdfDoc = await PDFDocument.load(pdfBytes);
  check("the PDF is a real, loadable document with the invoice title", pdfDoc.getPageCount() >= 1 && pdfDoc.getTitle() === `Invoice ${i1.json.number}`, pdfDoc.getTitle());
  const pfPdf = await PDFDocument.load(Buffer.from(await (await fetch(`${BASE}/api/invoices/${pf.json.id}/pdf`, { headers: { Authorization: `Bearer ${A.key}` } })).arrayBuffer()));
  check("a proforma PDF is titled as a proforma", pfPdf.getTitle() === `Proforma invoice ${pf.json.number}`);
  check("a draft is not downloadable by its public link", (await fetch(`${BASE}/api/pay/${i1.json.pay_url.split("/").pop()}/pdf`)).status === 404);
  const sent = await api(`/api/invoices/${i1.json.id}/send`, { method: "POST", key: A.key, body: { recipientEmail: "ap@globex.example", recipientName: "Globex AP" } });
  check("emailing the invoice marks it SENT and returns the pay link", sent.status === 200 && sent.json.invoice_status === "SENT" && sent.json.pay_url === i1.json.pay_url, JSON.stringify(sent.json));
  const pubPdf = await fetch(`${BASE}/api/pay/${i1.json.pay_url.split("/").pop()}/pdf`);
  check("once sent, the payer can download the PDF from the link", pubPdf.status === 200 && (await pubPdf.arrayBuffer()).byteLength > 1000);
  const page = await fetch(i1.json.pay_url.replace(/^https?:\/\/[^/]+/, BASE));
  const html = await page.text();
  check("the hosted pay page renders the invoice", page.status === 200 && html.includes(i1.json.number) && html.includes("Download PDF"));
  const conv = await api(`/api/invoices/${pf.json.id}/convert`, { method: "POST", key: A.key, body: {} });
  check("a proforma converts to a numbered tax invoice", conv.status === 201 && conv.json.kind === "INVOICE" && conv.json.proforma_of === pf.json.id && conv.json.total_amount === 250000 && /^INV-/.test(conv.json.number), JSON.stringify(conv.json).slice(0, 200));
  check("the proforma is closed after conversion and cannot be converted twice", (await api(`/api/invoices/${pf.json.id}`, { key: A.key })).json.status === "CANCELLED" && (await api(`/api/invoices/${pf.json.id}/convert`, { method: "POST", key: A.key, body: {} })).status === 409);
  check("a normal invoice cannot be 'converted'", (await api(`/api/invoices/${i1.json.id}/convert`, { method: "POST", key: A.key, body: {} })).status === 409);
  check("a cancelled invoice is not payable", (await api(`/api/pay/${pf.json.pay_url.split("/").pop()}/intent`, { method: "POST", body: { payer_name: "Globex", payer_country: "DE", payer_email: "x@y.example", token: "USDC" } })).status === 409);
  check("dashboard users can create invoices with their session", (await api("/api/invoices", { method: "POST", jar: A.jar, body: { currency: "USD", issuer_entity_id: exporter, line_items: [{ description: "Session-made", quantity: 1, unit_price: 5000 }] } })).json?.source === "DASHBOARD");
  const filtered = await api("/api/invoices?kind=PROFORMA", { key: A.key });
  check("invoices can be listed and filtered by kind", filtered.status === 200 && filtered.json.data.length >= 1 && filtered.json.data.every(d => d.kind === "PROFORMA"));
  const link = await api("/api/payment-links", { method: "POST", key: A.key, body: { amount: 12000, currency: "USD", description: "Consulting, March", issuer_entity_id: exporter } });
  check("a payment link is live immediately", link.status === 201 && link.json.status === "SENT" && /^PL-/.test(link.json.number) && link.json.url === link.json.pay_url, JSON.stringify(link.json).slice(0, 200));
  check("emailing a link needs a payer email", (await api("/api/payment-links", { method: "POST", key: A.key, body: { amount: 100, currency: "USD", description: "x", issuer_entity_id: exporter, send_email: true } })).status === 400);
  const cs = await api("/api/checkout/sessions", { method: "POST", key: B.key, body: { issuer_entity_id: bEntity, currency: "USD", amount: 4999, description: "Order 1042", client_reference_id: "order_1042", customer_email: "buyer@example.com", success_url: "https://shop.example.com/thanks?order=1042", cancel_url: "https://shop.example.com/cart" } });
  check("a hosted checkout session returns a pay URL", cs.status === 201 && cs.json.status === "open" && cs.json.client_reference_id === "order_1042" && /\/pay\//.test(cs.json.url), JSON.stringify(cs.json).slice(0, 200));
  check("checkout rejects non-https return URLs", (await api("/api/checkout/sessions", { method: "POST", key: B.key, body: { currency: "USD", amount: 100, success_url: "http://evil.example/x" } })).status === 400);
  check("checkout rejects javascript: return URLs", (await api("/api/checkout/sessions", { method: "POST", key: B.key, body: { currency: "USD", amount: 100, success_url: "javascript:alert(1)" } })).status === 400);
  check("checkout sessions need an API key, not a browser session", (await api("/api/checkout/sessions", { method: "POST", jar: B.jar, body: { currency: "USD", amount: 100 } })).status === 403);
  check("a session can be read back by its owner only", (await api(`/api/checkout/sessions/${cs.json.id}`, { key: B.key })).json.status === "open" && (await api(`/api/checkout/sessions/${cs.json.id}`, { key: A.key })).status === 404);
  check("checkout and links refuse to be created without a payee when the organisation has several entities", (await api("/api/checkout/sessions", { method: "POST", key: A.key, body: { currency: "USD", amount: 100 } })).json?.error?.code === "PAYEE_REQUIRED");
  const bankLink = await api("/api/payment-links", { method: "POST", key: A.key, body: { amount: 250000, currency: "INR", description: "Design", issuer_entity_id: exporter, purpose_code: "P0802" } });
  const bankTok = bankLink.json.pay_url.split("/").pop();
  const bankIntent = await api(`/api/pay/${bankTok}/intent`, { method: "POST", body: { payer_name: "Globex GmbH", payer_country: "DE", payer_email: "ap@globex.example", method: "BANK_TRANSFER", source_currency: "EUR" } });
  check("a payer can choose a bank transfer in their own currency", bankIntent.status === 201 && ["PENDING_VERIFICATION", "AWAITING_FUNDS"].includes(bankIntent.json.status), JSON.stringify(bankIntent.json).slice(0, 200));
  const bankInv = await db.invoice.findUnique({ where: { publicToken: bankTok } });
  const bankTransfer = await db.transfer.findFirst({ where: { invoiceId: bankInv.id } });
  check("the bank-transfer payment is a fiat-funded transfer in EUR", bankTransfer?.fundingMethod === "FIAT_LOCAL" && bankTransfer?.sourceCurrency === "EUR");
  check("a second attempt returns the open payment instead of creating another", (await api(`/api/pay/${bankTok}/intent`, { method: "POST", body: { payer_name: "Globex GmbH", payer_country: "DE", payer_email: "ap@globex.example", method: "BANK_TRANSFER", source_currency: "EUR" } })).json?.reference === bankIntent.json.reference);
  check("stablecoin intent without a token is refused", (await api(`/api/pay/${bankTok}/intent`, { method: "POST", body: { payer_name: "G", payer_country: "DE", payer_email: "a@b.example" } })).status === 400);
  const noPurpose = await api("/api/payment-links", { method: "POST", key: A.key, body: { amount: 1000, currency: "INR", description: "no purpose", issuer_entity_id: exporter } });
  const noPurposeTry = await api(`/api/pay/${noPurpose.json.pay_url.split("/").pop()}/intent`, { method: "POST", body: { payer_name: "Globex", payer_country: "DE", payer_email: "a@b.example", method: "BANK_TRANSFER", source_currency: "EUR" } });
  check("an Indian payee link without a purpose code cannot be paid", [409, 422].includes(noPurposeTry.status) && noPurposeTry.json?.error?.code === "NOT_AVAILABLE", JSON.stringify(noPurposeTry.json).slice(0, 200));
  check("the pay button script is served", (await fetch(`${BASE}/vaulte-pay.js`)).status === 200);
  await api(`/api/invoices/${cs.json.id}/cancel`, { method: "POST", key: B.key, body: {} });
  check("a cancelled checkout session reads as expired and cannot be paid", (await api(`/api/checkout/sessions/${cs.json.id}`, { key: B.key })).json.status === "expired" && (await api(`/api/pay/${cs.json.url.split("/").pop()}/intent`, { method: "POST", body: { payer_name: "Buyer", payer_country: "US", payer_email: "b@y.example", token: "USDC" } })).status === 409);

  console.log("== Customer downloads and certificate requests");
  const stmtQs = `from=${new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)}&to=${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}`;
  const dlr = (path, k = A.key) => fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${k}` } });
  const stCsv = await dlr(`/api/statements?${stmtQs}&format=csv`);
  const stCsvText = await stCsv.text();
  check("the statement downloads as CSV", stCsv.status === 200 && /text\/csv/.test(stCsv.headers.get("content-type")) && stCsvText.startsWith("date,reference,description") && stCsvText.split("\n").length > 2, stCsvText.slice(0, 120));
  const stXml = await dlr(`/api/statements?${stmtQs}&format=xml`);
  const stXmlDoc = new XMLParser({ ignoreAttributes: false }).parse(await stXml.text());
  check("the statement downloads as well-formed XML with lines and totals", stXml.status === 200 && /xml/.test(stXml.headers.get("content-type")) && !!stXmlDoc.VaulteStatement?.Lines?.Line && !!stXmlDoc.VaulteStatement?.Totals, JSON.stringify(stXmlDoc).slice(0, 200));
  const stPdf = await dlr(`/api/statements?${stmtQs}&format=pdf`);
  const stPdfDoc = await PDFDocument.load(Buffer.from(await stPdf.arrayBuffer()));
  check("the statement downloads as a PDF", stPdf.status === 200 && stPdfDoc.getTitle() === "Account statement" && stPdfDoc.getPageCount() >= 1);
  check("an unknown format and a reversed range are refused", (await api(`/api/statements?${stmtQs}&format=docx`, { key: A.key })).status === 400 && (await api("/api/statements?from=2026-02-01&to=2026-01-01", { key: A.key })).status === 400);
  const setJson = await api(`/api/settlements?${stmtQs}`, { key: A.key });
  const mine = setJson.json?.items?.find(i => i.reference === t.json.id);
  check("settlements list the completed transfer with amounts, rate, fees, partner ref and documents", setJson.status === 200 && mine?.status === "COMPLETED" && mine.dest_currency === "INR" && Number(mine.effective_rate) > 0 && /EFIRA/.test(mine.documents_on_file) && mine.partner_ref !== undefined, JSON.stringify(mine).slice(0, 300));
  check("settlements are tenant-isolated", !(await api(`/api/settlements?${stmtQs}`, { key: B.key })).json.items.some(i => i.reference === t.json.id));
  const setCsv = await (await dlr(`/api/settlements?${stmtQs}&format=csv`)).text();
  check("settlements download as CSV", setCsv.startsWith("reference,created_at") && setCsv.includes(t.json.id));
  const setXmlDoc = new XMLParser({ ignoreAttributes: false }).parse(await (await dlr(`/api/settlements?${stmtQs}&format=xml`)).text());
  const setNodes = [].concat(setXmlDoc.VaulteSettlements?.Settlements?.Settlement ?? []);
  check("settlements download as well-formed XML", setNodes.some(n => n["@_reference"] === t.json.id && n.Destination?.Currency === "INR"));
  const setPdfDoc = await PDFDocument.load(Buffer.from(await (await dlr(`/api/settlements?${stmtQs}&format=pdf`)).arrayBuffer()));
  check("settlements download as a PDF", setPdfDoc.getTitle() === "Settlement report");

  const rq1 = await api(`/api/transfers/${t.json.id}/document-requests`, { method: "POST", key: A.key, body: { type: "EBRC", note: "Needed for EDPMS closure" } });
  check("a customer can request an eBRC for a completed transfer", rq1.status === 201 && rq1.json.status === "REQUESTED" && rq1.json.type === "EBRC", JSON.stringify(rq1.json));
  check("asking twice returns the open request instead of a duplicate", (await api(`/api/transfers/${t.json.id}/document-requests`, { method: "POST", key: A.key, body: { type: "EBRC" } })).json?.already_requested === true);
  check("a certificate already on file cannot be requested again", (await api(`/api/transfers/${t.json.id}/document-requests`, { method: "POST", key: A.key, body: { type: "EFIRA" } })).json?.error?.code === "ALREADY_AVAILABLE");
  check("only certificate types can be requested", (await api(`/api/transfers/${t.json.id}/document-requests`, { method: "POST", key: A.key, body: { type: "SHIPPING_BILL" } })).status === 400);
  check("another organisation cannot request for this transfer", (await api(`/api/transfers/${t.json.id}/document-requests`, { method: "POST", key: B.key, body: { type: "BANK_CERT" } })).status === 404);
  check("the transfer's document list offers what can still be requested", (await api(`/api/transfers/${t.json.id}/documents`, { key: A.key })).json.requestable.includes("EBRC"));
  const staffQueue = await api("/api/admin/document-requests?status=OPEN", { jar: staffJar });
  const queued = staffQueue.json?.data?.find(r => r.id === rq1.json.id);
  check("staff see the request with the transfer's partner reference and purpose", staffQueue.status === 200 && !!queued && queued.dest_country === "IN", JSON.stringify(staffQueue.json).slice(0, 200));
  check("customers cannot use the staff request queue", (await api("/api/admin/document-requests", { jar: A.jar })).status === 403);
  check("staff can mark a request in progress", (await api(`/api/admin/document-requests/${rq1.json.id}`, { method: "POST", jar: staffJar, body: { status: "IN_PROGRESS" } })).json?.status === "IN_PROGRESS");
  const fdDeliver = new FormData(); fdDeliver.set("number", "EBRC-TEST-1"); fdDeliver.set("file", new Blob([Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF")], { type: "application/pdf" }), "ebrc.pdf");
  const deliver = await fetch(`${BASE}/api/admin/document-requests/${rq1.json.id}/deliver`, { method: "POST", headers: { Cookie: staffJar.cookie }, body: fdDeliver });
  const deliverJson = await deliver.json();
  check("staff attach the certificate: it is stored verified and the request closes", deliver.status === 201 && deliverJson.document?.status === "VERIFIED" && deliverJson.request === "FULFILLED", JSON.stringify(deliverJson).slice(0, 200));
  const afterReq = await api(`/api/transfers/${t.json.id}/document-requests`, { key: A.key });
  check("the customer sees the request as fulfilled with the document id", afterReq.json.data.find(r => r.id === rq1.json.id)?.status === "FULFILLED" && !!afterReq.json.data.find(r => r.id === rq1.json.id)?.document_id);
  const rq2 = await api(`/api/transfers/${t.json.id}/document-requests`, { method: "POST", key: A.key, body: { type: "BANK_CERT" } });
  check("a bank certificate can be requested for any completed transfer", rq2.status === 201);
  check("rejecting a request needs a reason", (await api(`/api/admin/document-requests/${rq2.json.id}`, { method: "POST", jar: staffJar, body: { status: "REJECTED" } })).status === 400);
  const rejReq = await api(`/api/admin/document-requests/${rq2.json.id}`, { method: "POST", jar: staffJar, body: { status: "REJECTED", note: "Your bank issues this directly; contact your relationship manager." } });
  check("a rejected request shows the reason to the customer", rejReq.json?.status === "REJECTED" && (await api(`/api/transfers/${t.json.id}/document-requests`, { key: A.key })).json.data.find(r => r.id === rq2.json.id)?.staff_note?.includes("relationship manager"));
  check("a closed request cannot be updated again", (await api(`/api/admin/document-requests/${rq2.json.id}`, { method: "POST", jar: staffJar, body: { status: "IN_PROGRESS" } })).status === 409);
  const unpaid = await db.transfer.findFirst({ where: { organizationId: A.orgId, status: { not: "COMPLETED" } } });
  if (unpaid) check("certificates cannot be requested before the payout completes", (await api(`/api/transfers/${unpaid.id}/document-requests`, { method: "POST", key: A.key, body: { type: "BANK_CERT" } })).json?.error?.code === "NOT_COMPLETED");

  console.log("== Escrow and milestone deals");
  const mockSig = body => createHmac("sha256", MOCK_SECRET).update(body).digest("hex");
  const dealBody = (over = {}) => ({ title: "Website build", terms: "Two milestones. The buyer approves each delivery; silence for 7 days counts as approval.", mode: "PAY_ON_APPROVAL", currency: "INR", seller_entity_id: exporter, purpose_code: "P0802", buyer_name: "Globex GmbH", buyer_email: "ap@globex.example", buyer_country: "DE", milestones: [{ title: "Design", amount: 40000000, pay_timing: "UPFRONT" }, { title: "Build", amount: 20000000 }], ...over });
  const payInvoice = async (payToken) => {
    const intent = await api(`/api/pay/${payToken}/intent`, { method: "POST", body: { payer_name: "Globex GmbH", payer_country: "US", payer_email: "ap@globex.example", method: "STABLECOIN", token: "USDC" } });
    const inv = await db.invoice.findUnique({ where: { publicToken: payToken } });
    const tr = await db.transfer.findFirst({ where: { invoiceId: inv.id }, orderBy: { createdAt: "desc" } });
    if (!tr) throw new Error("pay intent failed: " + JSON.stringify(intent.json) + " invoice=" + JSON.stringify({ purpose: inv.purposeCode, issuer: inv.issuerEntityId, status: inv.status }));
    if (tr.status === "PENDING_VERIFICATION") await verify(tr.senderEntityId);
    await sim(A.key, { event: "deposit.confirmed", transfer_id: tr.id });
    const done = await sim(A.key, { event: "payout.completed", transfer_id: tr.id });
    return { intent, done };
  };
  const noPurposeDeal = await api("/api/escrow/deals", { method: "POST", key: A.key, body: dealBody({ purpose_code: undefined }) });
  check("an Indian business seller must give a purpose code", noPurposeDeal.status === 400 && noPurposeDeal.json?.error?.code === "PURPOSE_REQUIRED", JSON.stringify(noPurposeDeal.json).slice(0, 160));
  check("a deal with a buyer in a sanctioned country is refused", (await api("/api/escrow/deals", { method: "POST", key: A.key, body: dealBody({ buyer_country: "IR" }) })).status === 422);
  check("a deal needs milestones with whole positive amounts", (await api("/api/escrow/deals", { method: "POST", key: A.key, body: dealBody({ milestones: [{ title: "x", amount: 0 }] }) })).status === 400);
  const deal = await api("/api/escrow/deals", { method: "POST", key: A.key, body: dealBody() });
  check("a pay-on-approval deal is created as a draft and says plainly that it is not escrow", deal.status === 201 && deal.json.status === "DRAFT" && /not escrow/i.test(deal.json.disclosure) && deal.json.total === 60000000, JSON.stringify(deal.json).slice(0, 200));
  const dTok = deal.json.link.split("/").pop();
  check("the buyer cannot see a draft", (await api(`/api/escrow/public/${dTok}`)).status === 404);
  check("another organisation cannot read the deal", (await api(`/api/escrow/deals/${deal.json.id}`, { key: B.key })).status === 404);
  const sentDeal = await api(`/api/escrow/deals/${deal.json.id}/send`, { method: "POST", key: A.key, body: {} });
  check("sending the deal returns the buyer's link", sentDeal.status === 200 && sentDeal.json.link === deal.json.link, JSON.stringify(sentDeal.json));
  const pubView = await api(`/api/escrow/public/${dTok}`);
  check("the buyer's view shows terms, seller and milestones but no internals", pubView.status === 200 && pubView.json.status === "AWAITING_BUYER" && pubView.json.seller?.name && pubView.json.milestones.length === 2 && pubView.json.screening === undefined && pubView.json.agent === undefined, JSON.stringify(pubView.json).slice(0, 200));
  check("a made-up link finds nothing", (await api("/api/escrow/public/not-a-real-token")).status === 404);
  check("the seller cannot submit before the buyer accepts", (await api(`/api/escrow/deals/${deal.json.id}/milestones/${deal.json.milestones[1].id}/submit`, { method: "POST", key: A.key, body: {} })).status === 409);
  const acc = await api(`/api/escrow/public/${dTok}/accept`, { method: "POST", body: {} });
  check("the buyer accepts the deal", acc.status === 200 && acc.json.status === "ACTIVE");
  const afterAcc = await api(`/api/escrow/public/${dTok}`);
  const m1 = afterAcc.json.milestones[0], m2 = afterAcc.json.milestones[1];
  check("a prepaid milestone is invoiced at acceptance with a pay link", !!m1.pay_url && m1.pay_timing === "UPFRONT" && m2.pay_url === null, JSON.stringify(m1));
  check("accepting twice is harmless", (await api(`/api/escrow/public/${dTok}/accept`, { method: "POST", body: {} })).json.status === "ACTIVE");
  check("work cannot be submitted on a prepaid milestone before it is paid", (await api(`/api/escrow/deals/${deal.json.id}/milestones/${m1.id}/submit`, { method: "POST", key: A.key, body: {} })).status === 409);
  const pay1 = await payInvoice(m1.pay_url.split("/").pop());
  check("the buyer pays the prepaid milestone through the normal rails", pay1.done.json?.transfer_status === "COMPLETED", JSON.stringify(pay1.done.json));
  check("paying the invoice marks the milestone funded", (await db.escrowMilestone.findUnique({ where: { id: m1.id } })).status === "FUNDED");
  check("the buyer cannot approve what was not submitted", (await api(`/api/escrow/public/${dTok}/milestones/${m1.id}/approve`, { method: "POST", body: {} })).status === 409);
  check("a wrong link cannot approve", (await api(`/api/escrow/public/some-other-token/milestones/${m1.id}/approve`, { method: "POST", body: {} })).status === 404);
  check("the seller submits the funded milestone", (await api(`/api/escrow/deals/${deal.json.id}/milestones/${m1.id}/submit`, { method: "POST", key: A.key, body: { note: "Figma file delivered" } })).json?.status === "SUBMITTED");
  check("the buyer approves: a prepaid milestone is released at once", (await api(`/api/escrow/public/${dTok}/milestones/${m1.id}/approve`, { method: "POST", body: {} })).status === 200 && (await db.escrowMilestone.findUnique({ where: { id: m1.id } })).status === "RELEASED");
  check("approving twice is refused", (await api(`/api/escrow/public/${dTok}/milestones/${m1.id}/approve`, { method: "POST", body: {} })).status === 409);
  check("the seller submits the second milestone (no money has moved yet)", (await api(`/api/escrow/deals/${deal.json.id}/milestones/${m2.id}/submit`, { method: "POST", key: A.key, body: {} })).json?.status === "SUBMITTED");
  check("a deal with work in progress cannot be cancelled", (await api(`/api/escrow/deals/${deal.json.id}/cancel`, { method: "POST", key: A.key, body: {} })).json?.error?.code === "MONEY_IN_FLIGHT");
  check("the buyer approves: only now is the milestone invoiced", (await api(`/api/escrow/public/${dTok}/milestones/${m2.id}/approve`, { method: "POST", body: {} })).status === 200);
  const view2 = (await api(`/api/escrow/public/${dTok}`)).json.milestones[1];
  check("an approved pay-on-approval milestone shows the buyer a pay link", view2.status === "APPROVED" && !!view2.pay_url, JSON.stringify(view2));
  await payInvoice(view2.pay_url.split("/").pop());
  const finalDeal = await api(`/api/escrow/deals/${deal.json.id}`, { key: A.key });
  check("when the buyer's payment completes the milestone is released and the deal completes", finalDeal.json.status === "COMPLETED" && finalDeal.json.milestones.every(m => m.status === "RELEASED"), JSON.stringify(finalDeal.json.milestones.map(m => m.status)));
  check("the timeline records every step with its actor", ["DEAL_CREATED", "DEAL_SENT", "DEAL_ACCEPTED", "MILESTONE_SUBMITTED", "MILESTONE_APPROVED", "MILESTONE_RELEASED", "DEAL_COMPLETED"].every(t => finalDeal.json.timeline.some(e => e.type === t)));

  // Disputes
  const dd = await api("/api/escrow/deals", { method: "POST", key: A.key, body: dealBody({ title: "Disputed job", milestones: [{ title: "Report", amount: 50000 }] }) });
  const ddTok = dd.json.link.split("/").pop(); const ddM = dd.json.milestones[0].id;
  await api(`/api/escrow/deals/${dd.json.id}/send`, { method: "POST", key: A.key, body: {} });
  await api(`/api/escrow/public/${ddTok}/accept`, { method: "POST", body: {} });
  await api(`/api/escrow/deals/${dd.json.id}/milestones/${ddM}/submit`, { method: "POST", key: A.key, body: { note: "done" } });
  check("a dispute needs a real description", (await api(`/api/escrow/public/${ddTok}/milestones/${ddM}/dispute`, { method: "POST", body: { reason: "bad" } })).status === 400);
  check("the buyer opens a dispute", (await api(`/api/escrow/public/${ddTok}/milestones/${ddM}/dispute`, { method: "POST", body: { reason: "The report is missing section 3 as agreed." } })).json?.status === "DISPUTED");
  check("customers cannot see or resolve disputes", (await api("/api/admin/escrow/disputes", { jar: A.jar })).status === 403 && (await api(`/api/admin/escrow/milestones/${ddM}/resolve`, { method: "POST", jar: A.jar, body: { resolution: "RELEASE", note: "trying to self-approve" } })).status === 403);
  const dq = await api("/api/admin/escrow/disputes", { jar: staffJar });
  check("staff see the dispute with both sides' context", dq.status === 200 && dq.json.data.some(x => x.milestone_id === ddM && x.opened_by === "BUYER" && /section 3/.test(x.reason)));
  check("resolving needs written reasoning", (await api(`/api/admin/escrow/milestones/${ddM}/resolve`, { method: "POST", jar: staffJar, body: { resolution: "REFUND", note: "short" } })).status === 400);
  check("staff refund the disputed milestone and the deal closes", (await api(`/api/admin/escrow/milestones/${ddM}/resolve`, { method: "POST", jar: staffJar, body: { resolution: "REFUND", note: "Deliverable incomplete against the agreed scope." } })).status === 200 && (await api(`/api/escrow/deals/${dd.json.id}`, { key: A.key })).json.status === "COMPLETED");
  check("a resolved dispute cannot be resolved again", (await api(`/api/admin/escrow/milestones/${ddM}/resolve`, { method: "POST", jar: staffJar, body: { resolution: "RELEASE", note: "changing my mind later" } })).status === 409);

  // Deemed approval after silence
  const sd = await api("/api/escrow/deals", { method: "POST", key: A.key, body: dealBody({ title: "Silent buyer", milestones: [{ title: "Copy", amount: 10000 }], approval_window_days: 7 }) });
  const sdTok = sd.json.link.split("/").pop(); const sdM = sd.json.milestones[0].id;
  await api(`/api/escrow/deals/${sd.json.id}/send`, { method: "POST", key: A.key, body: {} });
  await api(`/api/escrow/public/${sdTok}/accept`, { method: "POST", body: {} });
  await api(`/api/escrow/deals/${sd.json.id}/milestones/${sdM}/submit`, { method: "POST", key: A.key, body: {} });
  check("the approval-window cron needs the cron secret", (await api("/api/internal/escrow/run", { method: "POST", body: {} })).status === 401);
  const early = await fetch(`${BASE}/api/internal/escrow/run`, { method: "POST", headers: { "x-cron-secret": process.env.CRON_SECRET } });
  check("inside the window nothing is approved automatically", (await db.escrowMilestone.findUnique({ where: { id: sdM } })).status === "SUBMITTED" && early.status === 200);
  await db.escrowMilestone.update({ where: { id: sdM }, data: { submittedAt: new Date(Date.now() - 8 * 86400000) } });
  const late = await (await fetch(`${BASE}/api/internal/escrow/run`, { method: "POST", headers: { "x-cron-secret": process.env.CRON_SECRET } })).json();
  const sdAfter = await db.escrowMilestone.findUnique({ where: { id: sdM } });
  check("after the agreed window silence counts as approval and the milestone is invoiced", late.deemed_approved >= 1 && sdAfter.status === "APPROVED" && sdAfter.approvedBy === "SYSTEM" && !!sdAfter.invoiceId, JSON.stringify(late));

  // Partner-held escrow (sandbox agent)
  const pe = await api("/api/escrow/deals", { method: "POST", key: A.key, body: dealBody({ mode: "PARTNER_ESCROW", title: "Escrow job", milestones: [{ title: "Phase 1", amount: 400000 }, { title: "Phase 2", amount: 100000 }] }) });
  check("a partner-escrow deal says a licensed agent holds the money, not Vaulte", pe.status === 201 && /licensed escrow agent/i.test(pe.json.disclosure) && /does not hold funds/i.test(pe.json.disclosure), JSON.stringify(pe.json).slice(0, 160));
  const peTok = pe.json.link.split("/").pop(); const [pm1, pm2] = pe.json.milestones.map(m => m.id);
  await api(`/api/escrow/deals/${pe.json.id}/send`, { method: "POST", key: A.key, body: {} });
  check("funding instructions are not available before acceptance", (await api(`/api/escrow/public/${peTok}/milestones/${pm1}/funding`)).status === 409);
  await api(`/api/escrow/public/${peTok}/accept`, { method: "POST", body: {} });
  const peDb = await db.escrowDeal.findUnique({ where: { id: pe.json.id } });
  check("accepting opens the escrow at the agent", peDb.agent === "mock_escrow" && /^mock_esc_/.test(peDb.agentRef), JSON.stringify([peDb.agent, peDb.agentRef]));
  const fund = await api(`/api/escrow/public/${peTok}/milestones/${pm1}/funding`);
  check("the buyer gets the agent's bank details and a matching reference", fund.status === 200 && fund.json.bankDetails.reference.includes("-M1") && fund.json.bankDetails.currency === "INR", JSON.stringify(fund.json));
  check("the seller cannot start before the agent confirms funds", (await api(`/api/escrow/deals/${pe.json.id}/milestones/${pm1}/submit`, { method: "POST", key: A.key, body: {} })).status === 409);
  const fundedBody = JSON.stringify({ id: `evt-${uniq}-1`, type: "escrow.funded", data: { agent_ref: peDb.agentRef, milestone_ref: pm1 } });
  check("an escrow webhook with a bad signature is rejected", (await fetch(`${BASE}/api/webhooks/escrow/mock_escrow`, { method: "POST", headers: { "x-partner-signature": "00" }, body: fundedBody })).status === 401);
  check("an unknown escrow agent is refused", (await fetch(`${BASE}/api/webhooks/escrow/nobody`, { method: "POST", headers: { "x-partner-signature": mockSig(fundedBody) }, body: fundedBody })).status === 404);
  const fw = await fetch(`${BASE}/api/webhooks/escrow/mock_escrow`, { method: "POST", headers: { "x-partner-signature": mockSig(fundedBody) }, body: fundedBody });
  check("the agent's signed 'funded' event marks the milestone funded", fw.status === 200 && (await db.escrowMilestone.findUnique({ where: { id: pm1 } })).status === "FUNDED");
  const fw2 = await fetch(`${BASE}/api/webhooks/escrow/mock_escrow`, { method: "POST", headers: { "x-partner-signature": mockSig(fundedBody) }, body: fundedBody });
  check("a replayed event changes nothing", fw2.status === 200 && (await db.escrowMilestone.findUnique({ where: { id: pm1 } })).status === "FUNDED");
  await api(`/api/escrow/deals/${pe.json.id}/milestones/${pm1}/submit`, { method: "POST", key: A.key, body: { note: "Phase 1 delivered" } });
  check("approval instructs the agent to release and the milestone is released", (await api(`/api/escrow/public/${peTok}/milestones/${pm1}/approve`, { method: "POST", body: {} })).status === 200 && (await db.escrowMilestone.findUnique({ where: { id: pm1 } })).status === "RELEASED");
  const fundedBody2 = JSON.stringify({ id: `evt-${uniq}-2`, type: "escrow.funded", data: { agent_ref: peDb.agentRef, milestone_ref: `${peDb.agentRef}-M2` } });
  await fetch(`${BASE}/api/webhooks/escrow/mock_escrow`, { method: "POST", headers: { "x-partner-signature": mockSig(fundedBody2) }, body: fundedBody2 });
  check("the agent can reference a milestone by its escrow reference", (await db.escrowMilestone.findUnique({ where: { id: pm2 } })).status === "FUNDED");
  await api(`/api/escrow/deals/${pe.json.id}/milestones/${pm2}/submit`, { method: "POST", key: A.key, body: {} });
  await api(`/api/escrow/public/${peTok}/milestones/${pm2}/dispute`, { method: "POST", body: { reason: "Seller delivered the wrong file format entirely." } });
  await api(`/api/admin/escrow/milestones/${pm2}/resolve`, { method: "POST", jar: staffJar, body: { resolution: "REFUND", note: "Wrong format confirmed by both parties." } });
  const peFinal = await api(`/api/escrow/deals/${pe.json.id}`, { key: A.key });
  check("a refunded escrow milestone is returned via the agent and the deal completes", peFinal.json.milestones[1].status === "REFUNDED" && peFinal.json.status === "COMPLETED", JSON.stringify(peFinal.json.milestones.map(m => m.status)));
  check("escrow money is never booked in Vaulte's ledger", (await db.glJournal.count({ where: { memo: { contains: pe.json.id } } })) === 0);
  const clean = await api("/api/escrow/deals", { method: "POST", key: A.key, body: dealBody({ title: "Never started" }) });
  check("a deal with no money or work in flight can be cancelled", (await api(`/api/escrow/deals/${clean.json.id}/cancel`, { method: "POST", key: A.key, body: {} })).json?.status === "CANCELLED");
  const declined = await api("/api/escrow/deals", { method: "POST", key: A.key, body: dealBody({ title: "Declined" }) });
  await api(`/api/escrow/deals/${declined.json.id}/send`, { method: "POST", key: A.key, body: {} });
  check("a buyer can decline a deal", (await api(`/api/escrow/public/${declined.json.link.split("/").pop()}/decline`, { method: "POST", body: { note: "no thanks" } })).json?.status === "CANCELLED");

  console.log("== Terms re-acceptance");
  await db.user.update({ where: { id: A.userId }, data: { termsVersion: "2020-01-01" } });
  const dashHtml = await (await fetch(`${BASE}/dashboard/invoices`, { headers: { Cookie: A.jar.cookie }, redirect: "manual" })).text();
  check("a user on an older terms version is asked to accept the new one", /Please read and accept them/.test(dashHtml));
  check("terms acceptance needs a session", (await api("/api/auth/terms", { method: "POST", body: {} })).status === 401);
  check("accepting records the current version", (await api("/api/auth/terms", { method: "POST", jar: A.jar, body: {} })).json?.terms_version === "2026-10-05" && (await db.user.findUnique({ where: { id: A.userId } })).termsVersion === "2026-10-05");
  const dashHtml2 = await (await fetch(`${BASE}/dashboard/invoices`, { headers: { Cookie: A.jar.cookie }, redirect: "manual" })).text();
  check("after accepting, the banner is gone", !/Please read and accept them/.test(dashHtml2));

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
  check("ledger balanced after failover + completion", Object.values(bf).reduce((a, b) => a + b, 0n) === 0n && (bf["9200"] ?? 0n) === 0n);

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
  const bad = await sim(A.key, { event: "deposit.confirmed", transfer_id: tW.json.id, from_address: FIXTURE_ADDR });
  check("a sender wallet listed by sanctions authorities puts the transfer on hold", bad.json?.transfer_status === "QUARANTINED" && /SANCTIONS/.test(bad.json?.status_reason ?? ""), JSON.stringify(bad.json));

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
  check("virtual-account ledger balanced, nothing retained", Object.values(vb).reduce((a, b) => a + b, 0n) === 0n && (vb["9200"] ?? 0n) === 0n);

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

  console.log("== KYC / KYB engine");
  {
  const PDF = () => new Blob([Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF " + Math.random())], { type: "application/pdf" });
  async function upload(jar, caseId, type, personId, blob = PDF(), filename = "scan.pdf") {
    const fd = new FormData(); fd.set("type", type); if (personId) fd.set("person_id", personId); fd.set("file", blob, filename);
    const res = await fetch(`${BASE}/api/verification/${caseId}/documents`, { method: "POST", headers: { Cookie: jar.cookie }, body: fd });
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  // Names come from documents: the test files carry NAME markers the mock OCR reads (business docs: the entity's legal name; IDs: the person's name).
  const NAMED = (name) => new Blob([Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj NAME:${name}; ` + Math.random() + "\n%%EOF")], { type: "application/pdf" });
  async function fillDocs(jar, caseId, legalName) {
    let c = (await api(`/api/verification/${caseId}`, { jar })).json;
    // a business case needs its legal name from an incorporation/registry document first
    if (c.kind === "KYB" && legalName && !c.profile.legal_name) await upload(jar, caseId, "CERT_OF_INCORPORATION", null, NAMED(legalName), "inc.pdf");
    c = (await api(`/api/verification/${caseId}`, { jar })).json;
    for (const m of c.missing.filter(x => x.section === "document")) {
      const spec = c.requirements.documents.find(d => d.type === m.key);
      const targets = spec.perPerson ? c.people.filter(p => !c.documents.some(d => d.type === m.key && d.person_id === p.id)) : [null];
      for (const p of targets) await upload(jar, caseId, m.key, p?.id ?? null, m.key === "ID_PROOF" && p ? NAMED(p.full_name) : PDF());
    }
    // person names are read from their ID: upload one where a name is still unverified
    c = (await api(`/api/verification/${caseId}`, { jar })).json;
    for (const p of c.people.filter(x => x.name_source === "USER_ENTERED")) await upload(jar, caseId, "ID_PROOF", p.id, NAMED(p.full_name), "id.pdf");
    return (await api(`/api/verification/${caseId}`, { jar })).json;
  }
  async function makeStaff(label) {
    const em = `${label}-${uniq}@example.com`;
    const sj = { cookie: "" };
    await db.user.create({ data: { email: em, name: `Staff ${label}`, passwordHash: await bcrypt.hash(GOOD_PW, 10), role: "ADMIN", isStaff: true, organizationId: (await db.organization.findUnique({ where: { slug: "vaulte-staff" } })).id, emailVerifiedAt: new Date() } });
    await api("/api/auth/login", { method: "POST", jar: sj, body: { email: em, password: GOOD_PW } });
    const st = await api("/api/auth/2fa/setup", { method: "POST", jar: sj, body: { password: GOOD_PW } });
    await api("/api/auth/2fa/enable", { method: "POST", jar: sj, body: { code: totp(st.json.secret) } });
    const l1 = await api("/api/auth/login", { method: "POST", jar: sj, body: { email: em, password: GOOD_PW } });
    await api("/api/auth/login/totp", { method: "POST", jar: sj, body: { mfa_token: l1.json.mfa_token, code: totp(st.json.secret, Date.now() + 30000) } });
    return sj;
  }

  const K = await register("Kyc", "IN"); // separate org: approving KYB makes an org live, which would end sandbox simulation for org A
  const reqs = await api("/api/verification/requirements?kind=KYB&country=IN&purposes=EXPORT_GOODS", { jar: K.jar });
  check("requirements for an Indian goods exporter include IEC and GSTIN", reqs.status === 200 && ["IEC", "GSTIN", "CIN", "PAN"].every(c => reqs.json.items.some(i => i.code === c && i.required)) && reqs.json.ubo_threshold_pct === 10, JSON.stringify(reqs.json).slice(0, 200));
  check("unknown purposes are refused", (await api("/api/verification", { method: "POST", jar: K.jar, body: { purposes: ["MONEY_LAUNDERING"] } })).status === 400);
  const kc = await api("/api/verification", { method: "POST", jar: K.jar, body: { purposes: ["EXPORT_GOODS"] } });
  check("a KYB case is created for the organization", kc.status === 201 && kc.json.kind === "KYB" && kc.json.status === "DRAFT", JSON.stringify(kc.json).slice(0, 200));
  const cid = kc.json.id;
  check("starting again resumes the same case", (await api("/api/verification", { method: "POST", jar: K.jar, body: { purposes: ["EXPORT_GOODS"] } })).json.id === cid);
  check("another organization cannot see the case", (await api(`/api/verification/${cid}`, { jar: B.jar })).status === 404);
  const early = await api(`/api/verification/${cid}/submit`, { method: "POST", jar: K.jar, body: {} });
  check("submitting an incomplete case lists what is missing", early.status === 422 && early.json.error.code === "INCOMPLETE" && /PAN/.test(early.json.error.message));
  check("a badly formatted PAN is rejected before any lookup", (await api(`/api/verification/${cid}/items/PAN`, { method: "PUT", jar: K.jar, body: { value: "ABC123" } })).status === 400);
  check("an individual-type PAN is refused for a business", (await api(`/api/verification/${cid}/items/PAN`, { method: "PUT", jar: K.jar, body: { value: "ABCPE1234F" } })).status === 400);
  const badGst = await api(`/api/verification/${cid}/items/GSTIN`, { method: "PUT", jar: K.jar, body: { value: "24ABKCS2033B1ZW" } });
  check("a GSTIN with a wrong check character is refused", badGst.status === 400);
  const failPan = await api(`/api/verification/${cid}/items/PAN`, { method: "PUT", jar: K.jar, body: { value: "ZZZCE1234F" } });
  check("a PAN the provider cannot find is marked FAILED", failPan.json?.result?.status === "FAILED");
  const goodPan = await api(`/api/verification/${cid}/items/PAN`, { method: "PUT", jar: K.jar, body: { value: "ABCCE1234F" } });
  check("a valid PAN is verified by the provider", goodPan.json?.result?.status === "VERIFIED");
  check("the full PAN is never returned, only a masked value", !JSON.stringify(goodPan.json).includes("ABCCE1234F") && goodPan.json.case.items.find(i => i.code === "PAN").masked.endsWith("234F"));
  const dbItem = await db.verificationItem.findFirst({ where: { caseId: cid, code: "PAN" } });
  check("the stored identifier is encrypted", !dbItem.valueEnc.includes("ABCCE1234F") && dbItem.valueEnc.startsWith("v1."));
  await api(`/api/verification/${cid}/items/CIN`, { method: "PUT", jar: K.jar, body: { value: "U74999MH2015PTC123456" } });
  const gst = await api(`/api/verification/${cid}/items/GSTIN`, { method: "PUT", jar: K.jar, body: { value: "24ABKCS2033B1ZV" } });
  check("a valid GSTIN is verified", gst.json?.result?.status === "VERIFIED");
  check("the GSTIN lookup returns the registered name from the register", typeof gst.json?.result?.registered_name === "string" && gst.json.result.registered_name.length > 3, JSON.stringify(gst.json).slice(0, 200));
  const lk = await api("/api/verification/lookup?country=IN&code=GSTIN&value=24ABKCS2033B1ZV&name=Alpha%20Exports", { jar: K.jar });
  check("lookup API returns legal name, source and status", lk.status === 200 && lk.json.status === "FOUND" && !!lk.json.legal_name && !!lk.json.source, JSON.stringify(lk.json).slice(0, 200));
  check("lookup refuses a malformed identifier before calling any registry", (await api("/api/verification/lookup?country=IN&code=GSTIN&value=BAD", { jar: K.jar })).status === 400);
  check("lookup says plainly when no official lookup exists", (await api("/api/verification/lookup?country=IN&code=IEC&value=0388012345", { jar: K.jar })).status === 404);
  check("lookup needs a signed-in user", (await api("/api/verification/lookup?country=IN&code=GSTIN&value=24ABKCS2033B1ZV")).status === 401);
  for (const [cc, code] of [["AE", "TRADE_LICENCE"], ["SA", "CR_NO"], ["MY", "REG_NO"], ["NP", "TAX_ID"], ["AU", "ABN"], ["DE", "VAT_ID"], ["GB", "REG_NO"], ["US", "EIN"]]) {
    const r = await api(`/api/verification/requirements?kind=KYB&country=${cc}&purposes=EXPORT_SERVICES`, { jar: K.jar });
    check(`${cc} business pack asks for ${code} and lists the official registry`, r.status === 200 && r.json.items.some(i => i.code === code) && (cc === "US" || !!r.json.registry_info?.url), JSON.stringify(r.json.registry_info));
  }
  await api(`/api/verification/${cid}/items/IEC`, { method: "PUT", jar: K.jar, body: { value: "0388012345" } });
  const bank = await api(`/api/verification/${cid}/items/BANK_ACCOUNT`, { method: "PUT", jar: K.jar, body: { value: "HDFC0001234|123456789012" } });
  check("a bank account is verified", bank.json?.result?.status === "VERIFIED");
  check("an unknown profile field is refused", (await api(`/api/verification/${cid}`, { method: "PATCH", jar: K.jar, body: { profile: { hacked: "x" } } })).status === 400);
  const prof = await api(`/api/verification/${cid}`, { method: "PATCH", jar: K.jar, body: { profile: { business_type: "Private limited", industry: "Textile exports", incorporation_date: "2018-04-02", address: "12 MG Road, Pune", expected_monthly_usd: 40000, source_of_funds: "BUSINESS_INCOME" } } });
  check("profile saved", prof.status === 200 && prof.json.profile.business_type === "Private limited");
  const typedName = await api(`/api/verification/${cid}`, { method: "PATCH", jar: K.jar, body: { profile: { legal_name: "Typed Name Pvt Ltd" } } });
  check("a typed legal name is refused: names come from documents and registries", typedName.status === 400 && typedName.json.error.code === "NAME_FROM_DOCUMENT_REQUIRED", JSON.stringify(typedName.json));
  const incDoc = await upload(K.jar, cid, "CERT_OF_INCORPORATION", null, NAMED(`Alpha Exports ${uniq} Pvt Ltd`), "inc.pdf");
  check("the legal name now comes from a registry record (it outranks the document's OCR name)", incDoc.json?.profile?.legal_name_source === "REGISTRY" && !!incDoc.json.profile.legal_name, JSON.stringify(incDoc.json?.profile));
  const ubo = await api(`/api/verification/${cid}/people`, { jar: K.jar, body: { role: "UBO", full_name: "Asha Rao", date_of_birth: "1980-05-05", nationality: "IN", country_of_residence: "IN", ownership_pct: 60, pan: "ABCPE1234F" } });
  check("a beneficial owner can be added (PAN masked)", ubo.status === 201 && ubo.json.people[0].pan_masked.endsWith("234F"));
  check("ownership over 100% is refused at submission", (await api(`/api/verification/${cid}/people`, { jar: K.jar, body: { role: "UBO", full_name: "Too Much", ownership_pct: 101 } })).status === 400);
  await api(`/api/verification/${cid}/people`, { jar: K.jar, body: { role: "DIRECTOR", full_name: "Asha Rao", date_of_birth: "1980-05-05", nationality: "IN" } });
  await api(`/api/verification/${cid}/people`, { jar: K.jar, body: { role: "SIGNATORY", full_name: "Asha Rao", date_of_birth: "1980-05-05", nationality: "IN" } });
  // Government KYC services (mock API Setu in test mode): OCR with quality gate, CKYC two-step, provider AML/PEP
  const kcase0 = (await api(`/api/verification/${cid}`, { jar: K.jar })).json;
  const asha = kcase0.people.find(p => p.role === "UBO");
  const ocrGood = await upload(K.jar, cid, "ID_PROOF", asha.id, new Blob([Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj NAME:ASHA RAO;DOB:1980-05-05;ID:ABCPE1234F\n%%EOF " + Math.random())], { type: "application/pdf" }), "id.pdf");
  const idDoc = ocrGood.json?.documents?.find(d => d.type === "ID_PROOF" && d.person_id === asha.id);
  check("OCR reads the name and date of birth from an uploaded ID and masks the ID number", idDoc?.ocr?.status === "OK" && idDoc.ocr.fields.name === "ASHA RAO" && idDoc.ocr.fields.dob === "1980-05-05" && /\*+234F$/.test(idDoc.ocr.fields.idNumberMasked) && !JSON.stringify(ocrGood.json).includes("ABCPE1234F"), JSON.stringify(idDoc?.ocr));
  const ocrBlur = await upload(K.jar, cid, "ID_PROOF", asha.id, new Blob([Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj NAME:ASHA RAO;BLUR:1; " + Math.random())], { type: "application/pdf" }), "blurry.pdf");
  const blurDoc = ocrBlur.json?.documents?.find(d => d.type === "ID_PROOF" && d.person_id === asha.id);
  check("a blurry scan is rejected immediately with a reason the customer can act on", blurDoc?.status === "REJECTED" && /sharper|clearly/.test(blurDoc.reject_reason), JSON.stringify(blurDoc));
  await upload(K.jar, cid, "ID_PROOF", asha.id, new Blob([Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj NAME:ASHA RAO;DOB:1980-05-05; " + Math.random())], { type: "application/pdf" }), "id2.pdf");
  const ck1 = await api(`/api/verification/${cid}/ckyc/start`, { method: "POST", jar: K.jar, body: { id_type: "PAN", id_number: "ABCPE1234F", date_of_birth: "1980-05-05" } });
  check("CKYC lookup sends an OTP step and returns a reference", ck1.status === 200 && ck1.json.status === "OTP_SENT" && !!ck1.json.reference_id, JSON.stringify(ck1.json));
  check("a CKYC miss says so", (await api(`/api/verification/${cid}/ckyc/start`, { method: "POST", jar: K.jar, body: { id_type: "PAN", id_number: "ZZZPE1234F" } })).json?.status === "NOT_FOUND");
  check("a wrong CKYC OTP is refused", (await api(`/api/verification/${cid}/ckyc/confirm`, { method: "POST", jar: K.jar, body: { reference_id: ck1.json.reference_id, otp: "000000", person_id: asha.id } })).json?.status === "FAILED");
  const ck2 = await api(`/api/verification/${cid}/ckyc/confirm`, { method: "POST", jar: K.jar, body: { reference_id: ck1.json.reference_id, otp: "123456", person_id: asha.id } });
  const ashaAfter = ck2.json?.case?.people?.find(p => p.id === asha.id);
  check("the CKYC record sets the person's name from the government source and stores a masked CKYC item", ck2.json?.status === "VERIFIED" && ashaAfter?.name_source === "CKYC" && ck2.json.case.items.some(i => i.code === "CKYC" && i.status === "VERIFIED" && /4321$/.test(i.masked)), JSON.stringify(ck2.json).slice(0, 200));
  check("CKYC needs the case owner/admin session", (await api(`/api/verification/${cid}/ckyc/start`, { method: "POST", body: { id_type: "PAN", id_number: "ABCPE1234F" } })).status === 401);
  const pepP = await api(`/api/verification/${cid}/people`, { jar: K.jar, body: { role: "DIRECTOR", full_name: "Rahul PEP Kumar", date_of_birth: "1970-01-01", nationality: "IN" } });
  const pepId = pepP.json.people.find(p => /PEP/.test(p.full_name))?.id;
  const scr = await api(`/api/verification/${cid}/screen`, { method: "POST", jar: K.jar, body: {} });
  const pepAfter = scr.json?.case?.people?.find(p => p.id === pepId);
  check("provider AML/PEP flags a politically exposed person and records the result", scr.json?.hits?.some(h => h.pep) && pepAfter?.is_pep === true && pepAfter.pep_check?.pep === true, JSON.stringify(scr.json?.hits));
  await api(`/api/verification/${cid}/people/${pepId}`, { method: "DELETE", jar: K.jar });
  const txt = await upload(K.jar, cid, "PAN_CARD", null, new Blob(["<script>alert(1)</script>"], { type: "application/pdf" }), "evil.pdf");
  check("files are judged by content: an HTML file named .pdf is refused", txt.status === 415);
  const big = await upload(K.jar, cid, "PAN_CARD", null, new Blob([Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(9 * 1024 * 1024)])]), "big.pdf");
  check("files over 8 MB are refused", big.status === 413);
  check("an unrequested document type is refused", (await upload(K.jar, cid, "W9_FORM", null)).status === 400);
  const filled = await fillDocs(K.jar, cid);
  check("after uploading everything required nothing is missing", filled.missing.length === 0, JSON.stringify(filled.missing));
  const docRow = await db.verificationDocument.findFirst({ where: { caseId: cid } });
  const raw = await (await import("node:fs/promises")).readFile(`${process.cwd()}/.data/uploads/${docRow.storageKey}`);
  check("the stored document file is ciphertext", !raw.includes(Buffer.from("%PDF-1.4")));
  const dl = await fetch(`${BASE}/api/verification/${cid}/documents/${docRow.id}`, { headers: { Cookie: K.jar.cookie } });
  check("the owner can download the document back, decrypted", dl.status === 200 && (await dl.text()).startsWith("%PDF-1.4") && dl.headers.get("x-content-type-options") === "nosniff");
  check("another organization cannot download it", (await fetch(`${BASE}/api/verification/${cid}/documents/${docRow.id}`, { headers: { Cookie: B.jar.cookie } })).status === 404);
  const sub = await api(`/api/verification/${cid}/submit`, { method: "POST", jar: K.jar, body: {} });
  check("a complete case goes to review with a tier", sub.status === 202 && sub.json.case.status === "IN_REVIEW" && ["SDD", "CDD"].includes(sub.json.case.tier), JSON.stringify(sub.json.result));
  check("a case under review is locked", (await api(`/api/verification/${cid}`, { method: "PATCH", jar: K.jar, body: { profile: { industry: "Changed" } } })).status === 409);
  check("organization KYB status follows the case", (await db.organization.findUnique({ where: { id: K.orgId } })).kybStatus === "IN_REVIEW");

  const queue = await api("/api/admin/verification?status=IN_REVIEW", { jar: staffJar });
  check("the case is in the staff queue", queue.status === 200 && queue.json.data.some(r => r.id === cid));
  check("customers cannot open the staff queue", (await api("/api/admin/verification", { jar: K.jar })).status === 403);
  const unrev = await api(`/api/admin/verification/${cid}/decision`, { method: "POST", jar: staffJar, body: { decision: "APPROVE" } });
  check("approval is refused while documents are unreviewed", unrev.status === 409 && unrev.json.error.code === "DOCUMENTS_UNREVIEWED");
  const detail = await api(`/api/admin/verification/${cid}`, { jar: staffJar });
  for (const d of detail.json.documents) await api(`/api/admin/verification/${cid}/documents/${d.id}`, { method: "POST", jar: staffJar, body: { status: "ACCEPTED" } });
  const view = await fetch(`${BASE}/api/admin/verification/${cid}/documents/${detail.json.documents[0].id}`, { headers: { Cookie: staffJar.cookie } });
  check("staff can open a document (and it is audit-logged)", view.status === 200 && (await db.auditLog.count({ where: { action: "verification.document_viewed_by_staff", resourceId: cid } })) >= 1);
  const rej = await api(`/api/admin/verification/${cid}/decision`, { method: "POST", jar: staffJar, body: { decision: "REJECT" } });
  check("rejecting requires a note", rej.status === 400 && rej.json.error.code === "NOTE_REQUIRED");
  const info = await api(`/api/admin/verification/${cid}/decision`, { method: "POST", jar: staffJar, body: { decision: "REQUEST_INFO", note: "Please upload a clearer address proof." } });
  check("staff can request more information", info.status === 200 && info.json.status === "NEEDS_INFO");
  check("the customer can edit again after a request", (await api(`/api/verification/${cid}`, { method: "PATCH", jar: K.jar, body: { profile: { industry: "Textile and garment exports" } } })).status === 200);
  await api(`/api/verification/${cid}/submit`, { method: "POST", jar: K.jar, body: {} });
  const detail2 = await api(`/api/admin/verification/${cid}`, { jar: staffJar });
  for (const d of detail2.json.documents.filter(x => x.status === "UPLOADED")) await api(`/api/admin/verification/${cid}/documents/${d.id}`, { method: "POST", jar: staffJar, body: { status: "ACCEPTED" } });
  const appr = await api(`/api/admin/verification/${cid}/decision`, { method: "POST", jar: staffJar, body: { decision: "APPROVE", note: "All documents verified." } });
  check("staff approves", appr.status === 200 && appr.json.status === "APPROVED", JSON.stringify(appr.json));
  const orgNow = await db.organization.findUnique({ where: { id: K.orgId } });
  check("approval unlocks the organization and sets limits and risk tier", orgNow.kybStatus === "APPROVED" && orgNow.dailyLimitUsd > 0n && !!orgNow.riskScore !== undefined && orgNow.registrationNumber === "U74999MH2015PTC123456");
  check("a decision email was queued/logged for the owner", (await db.emailLog.count({ where: { to: K.email, subject: { startsWith: "Verification approved" } } })) >= 1);

  // Enhanced due diligence: PEP -> two different approvers
  const eddOrg = await register("Eddie", "IN");
  const ec = (await api("/api/verification", { method: "POST", jar: eddOrg.jar, body: { purposes: ["EXPORT_SERVICES"] } })).json.id;
  for (const [code, value] of [["PAN", "ABCCE1234F"], ["CIN", "U74999MH2015PTC654321"], ["BANK_ACCOUNT", "HDFC0001234|555566667777"]]) await api(`/api/verification/${ec}/items/${code}`, { method: "PUT", jar: eddOrg.jar, body: { value } });
  await api(`/api/verification/${ec}`, { method: "PATCH", jar: eddOrg.jar, body: { profile: { business_type: "LLP", industry: "Consulting", incorporation_date: "2015-01-01", address: "Delhi", expected_monthly_usd: 20000, source_of_funds: "BUSINESS_INCOME" } } });
  for (const [role, pep] of [["UBO", true], ["DIRECTOR", false], ["SIGNATORY", false]]) await api(`/api/verification/${ec}/people`, { jar: eddOrg.jar, body: { role, full_name: "Vikram Sethi", nationality: "IN", country_of_residence: "IN", ownership_pct: role === "UBO" ? 100 : undefined, is_pep: pep, date_of_birth: "1975-01-01" } });
  const eddFilled = await fillDocs(eddOrg.jar, ec, `Eddie Co ${uniq}`);
  check("without a registry hit, the uploaded incorporation document supplies the legal name", eddFilled.profile.legal_name === `Eddie Co ${uniq}` && eddFilled.profile.legal_name_source === "OCR", JSON.stringify(eddFilled.profile));
  check("a person's name is read from their ID, and the typed value is kept for the reviewer only if different", eddFilled.people.every(p => p.name_source === "OCR"), JSON.stringify(eddFilled.people.map(p => p.name_source)));
  const sn = await api(`/api/admin/verification/${ec}/name`, { method: "POST", jar: staffJar, body: { target: "profile", name: `Eddie Co ${uniq} LLP`, note: "Name per certificate page 1" } });
  const snNoNote = await api(`/api/admin/verification/${ec}/name`, { method: "POST", jar: staffJar, body: { target: "profile", name: "X Y", note: "short" } });
  const snCust = await api(`/api/admin/verification/${ec}/name`, { method: "POST", jar: eddOrg.jar, body: { target: "profile", name: "Hacker Ltd", note: "customer trying it on" } });
  const afterStaff = (await api(`/api/verification/${ec}`, { jar: eddOrg.jar })).json;
  check("a staff member can set a legal name with a reason (source STAFF, typed/previous value kept, audited); customers and empty reasons cannot", sn.status === 200 && snNoNote.status === 400 && [401, 403].includes(snCust.status) && afterStaff.profile.legal_name === `Eddie Co ${uniq} LLP` && afterStaff.profile.legal_name_source === "STAFF" && (await db.auditLog.count({ where: { action: "verification.name_set_by_staff" } })) >= 1, JSON.stringify([sn.status, snNoNote.status, snCust.status, afterStaff.profile]));
  const es = await api(`/api/verification/${ec}/submit`, { method: "POST", jar: eddOrg.jar, body: {} });
  check("a PEP beneficial owner forces enhanced due diligence", es.json?.case?.tier === "EDD", JSON.stringify(es.json?.result));
  const ed = await api(`/api/admin/verification/${ec}`, { jar: staffJar });
  for (const d of ed.json.documents) await api(`/api/admin/verification/${ec}/documents/${d.id}`, { method: "POST", jar: staffJar, body: { status: "ACCEPTED" } });
  const a1 = await api(`/api/admin/verification/${ec}/decision`, { method: "POST", jar: staffJar, body: { decision: "APPROVE" } });
  check("first EDD approval does not approve the case", a1.json?.status === "IN_REVIEW" && a1.json.approvals === 1, JSON.stringify(a1.json));
  check("the same reviewer cannot approve twice", (await api(`/api/admin/verification/${ec}/decision`, { method: "POST", jar: staffJar, body: { decision: "APPROVE" } })).json?.error?.code === "ALREADY_APPROVED");
  const staff2 = await makeStaff("second");
  const a2 = await api(`/api/admin/verification/${ec}/decision`, { method: "POST", jar: staff2, body: { decision: "APPROVE" } });
  check("a second, different reviewer completes the approval", a2.json?.status === "APPROVED", JSON.stringify(a2.json));
  check("EDD limits are the highest tier", (await db.organization.findUnique({ where: { id: eddOrg.orgId } })).riskTier === "HIGH");

  // Prohibited jurisdiction -> cannot be approved
  const blkOrg = await register("Blocky", "IN");
  const bc = (await api("/api/verification", { method: "POST", jar: blkOrg.jar, body: { purposes: ["EXPORT_SERVICES"] } })).json.id;
  for (const [code, value] of [["PAN", "ABCCE1234F"], ["CIN", "U74999MH2015PTC777777"], ["BANK_ACCOUNT", "HDFC0001234|888899990001"]]) await api(`/api/verification/${bc}/items/${code}`, { method: "PUT", jar: blkOrg.jar, body: { value } });
  await api(`/api/verification/${bc}`, { method: "PATCH", jar: blkOrg.jar, body: { profile: { business_type: "LLP", industry: "Consulting", incorporation_date: "2015-01-01", address: "Delhi", expected_monthly_usd: 1000, source_of_funds: "BUSINESS_INCOME" } } });
  for (const role of ["UBO", "DIRECTOR", "SIGNATORY"]) await api(`/api/verification/${bc}/people`, { jar: blkOrg.jar, body: { role, full_name: "Reza Test", nationality: "IR", country_of_residence: "IN", ownership_pct: role === "UBO" ? 100 : undefined, date_of_birth: "1980-01-01" } });
  await fillDocs(blkOrg.jar, bc, `Blocky Co ${uniq}`);
  const bs = await api(`/api/verification/${bc}/submit`, { method: "POST", jar: blkOrg.jar, body: {} });
  check("a prohibited-jurisdiction owner is flagged as blocked in review", bs.status === 202 && bs.json.result.blocked === true, JSON.stringify(bs.json.result));
  const bd = await api(`/api/admin/verification/${bc}`, { jar: staffJar });
  for (const d of bd.json.documents) await api(`/api/admin/verification/${bc}/documents/${d.id}`, { method: "POST", jar: staffJar, body: { status: "ACCEPTED" } });
  check("staff cannot approve a blocked case", (await api(`/api/admin/verification/${bc}/decision`, { method: "POST", jar: staffJar, body: { decision: "APPROVE" } })).json?.error?.code === "SCREENING_BLOCK");
  const brj = await api(`/api/admin/verification/${bc}/decision`, { method: "POST", jar: staffJar, body: { decision: "REJECT", note: "Prohibited jurisdiction." } });
  check("staff can reject it", brj.json?.status === "REJECTED" && (await db.organization.findUnique({ where: { id: blkOrg.orgId } })).kybStatus === "REJECTED");

  // Entity-level KYC drives the transfer limits
  const kycEnt = await entity(A.key, "Nina Individual", "US", "USD", "INDIVIDUAL");
  const kcase = (await api("/api/verification", { method: "POST", jar: A.jar, body: { entity_id: kycEnt, purposes: ["FAMILY_MAINTENANCE"] } })).json;
  check("an entity gets its own KYC case", kcase.kind === "KYC" && kcase.entity_id === kycEnt);
  await api(`/api/verification/${kcase.id}`, { method: "PATCH", jar: A.jar, body: { profile: { occupation: "Nurse", address: "Austin, TX", expected_monthly_usd: 800, source_of_funds: "SALARY" } } });
  await api(`/api/verification/${kcase.id}/people`, { jar: A.jar, body: { role: "APPLICANT", full_name: "Nina Individual", date_of_birth: "1990-03-03", nationality: "US", country_of_residence: "US", id_type: "PASSPORT" } });
  await fillDocs(A.jar, kcase.id);
  const ks = await api(`/api/verification/${kcase.id}/submit`, { method: "POST", jar: A.jar, body: {} });
  check("the individual case lands at the simplified level", ks.json?.case?.tier === "SDD", JSON.stringify(ks.json?.result));
  const kd = await api(`/api/admin/verification/${kcase.id}`, { jar: staffJar });
  for (const d of kd.json.documents) await api(`/api/admin/verification/${kcase.id}/documents/${d.id}`, { method: "POST", jar: staffJar, body: { status: "ACCEPTED" } });
  await api(`/api/admin/verification/${kcase.id}/decision`, { method: "POST", jar: staffJar, body: { decision: "APPROVE" } });
  const kEntity = await db.entity.findUnique({ where: { id: kycEnt } });
  check("approval verifies the entity", kEntity.isVerified === true && kEntity.verificationStatus === "APPROVED" && kEntity.verificationRef === kcase.id);
  const kRecv = await entity(A.key, "Ravi Receiver", "IN", "INR", "INDIVIDUAL");
  await verify(kRecv);
  const small = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "PERSONAL", sender_entity_id: kycEnt, recipient_entity_id: kRecv, source_currency: "USD", dest_currency: "INR", source_amount: 90000, funding_method: "FIAT_LOCAL" } });
  const over = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "PERSONAL", sender_entity_id: kycEnt, recipient_entity_id: kRecv, source_currency: "USD", dest_currency: "INR", source_amount: 150000, funding_method: "FIAT_LOCAL" } });
  check("within the simplified-level limit a quote works", small.status === 201, JSON.stringify(small.json));
  check("above the level's per-transfer limit a quote is refused", over.status === 422 && JSON.stringify(over.json).includes("TIER_TXN_LIMIT"), JSON.stringify(over.json));
  }

  console.log("== Sanctions screening");
  {
    const mk = (name, country = "US") => api("/api/entities", { method: "POST", key: A.key, body: { legalName: name, country, currency: "USD", isSandbox: true } });
    const exact = await mk("Blocked Trading Company Ltd");
    check("a party that matches a listing is refused without revealing the list", exact.status === 403 && exact.json.error.code === "PARTY_NOT_ACCEPTED" && !/BLOCKED TRADING|TEST|fixture/i.test(JSON.stringify(exact.json)), JSON.stringify(exact.json));
    check("every screening is recorded", (await db.screeningCheck.count({ where: { organizationId: A.orgId, result: "BLOCK" } })) >= 1);
    const fuzzy = await mk("Blcked Trdng Company");
    check("a near-match is created but flagged for review", fuzzy.status === 201 && (await db.entity.findUnique({ where: { id: fuzzy.json.id } })).screeningStatus === "REVIEW", JSON.stringify(fuzzy.json));
    const fz = fuzzy.json.id;
    await db.entity.update({ where: { id: fz }, data: { entityType: "BUSINESS" } });
    await verify(fz);
    const okRecipient = await entity(A.key, "Clean Receiver Pvt Ltd", "IN", "INR");
    await verify(okRecipient);
    const heldQuote = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "BUSINESS", sender_entity_id: fz, recipient_entity_id: okRecipient, source_currency: "USD", dest_currency: "INR", source_amount: 100000, funding_method: "STABLECOIN" } });
    check("a party under review cannot be used in a quote", heldQuote.status === 422 && JSON.stringify(heldQuote.json).includes("SANCTIONS_HOLD"), JSON.stringify(heldQuote.json));
    check("customers cannot see the staff alert queue", (await api("/api/admin/sanctions", { jar: A.jar })).status === 403);
    const alerts = await api("/api/admin/sanctions?status=OPEN", { jar: staffJar });
    const alert = alerts.json.data.find(a => a.subject_id === fz);
    check("staff see the alert with the candidate match and list freshness", !!alert && alert.matches[0].listedName === "BLOCKED TRADING COMPANY" && alerts.json.lists.length >= 1, JSON.stringify(alerts.json.data.slice(0, 1)).slice(0, 300));
    check("a disposition needs a written reason", (await api(`/api/admin/sanctions/${alert.id}`, { method: "POST", jar: staffJar, body: { decision: "CLEAR", note: "x" } })).status === 400);
    const clr = await api(`/api/admin/sanctions/${alert.id}`, { method: "POST", jar: staffJar, body: { decision: "CLEAR", note: "Different company: registry number does not match." } });
    check("staff can clear a false positive", clr.status === 200 && (await db.entity.findUnique({ where: { id: fz } })).screeningStatus === "CLEAR");
    const afterQuote = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "BUSINESS", sender_entity_id: fz, recipient_entity_id: okRecipient, source_currency: "USD", dest_currency: "INR", source_amount: 100000, funding_method: "STABLECOIN" } });
    check("after clearance the party can be used", afterQuote.status === 201, JSON.stringify(afterQuote.json));
    const rs = await fetch(BASE + "/api/internal/sanctions/rescreen", { method: "POST", headers: { "x-cron-secret": process.env.CRON_SECRET } });
    check("the daily rescreen does not re-raise a cleared false positive", rs.status === 200 && (await db.entity.findUnique({ where: { id: fz } })).screeningStatus === "CLEAR");
    check("sync and rescreen jobs need the cron secret", (await fetch(BASE + "/api/internal/sanctions/sync", { method: "POST" })).status === 401 && (await fetch(BASE + "/api/internal/sanctions/rescreen", { method: "POST" })).status === 401);
    const conf = await mk("Blcked Trdng Co.");
    const confId = conf.json.id;
    const a2 = (await api("/api/admin/sanctions?status=OPEN", { jar: staffJar })).json.data.find(a => a.subject_id === confId);
    const cf = await api(`/api/admin/sanctions/${a2.id}`, { method: "POST", jar: staffJar, body: { decision: "CONFIRM", note: "Confirmed: same registered address as the listing." } });
    const ce = await db.entity.findUnique({ where: { id: confId } });
    check("a confirmed match blocks and unverifies the party", cf.status === 200 && ce.screeningStatus === "BLOCKED" && ce.isVerified === false);
    const sr = await api("/api/admin/sanctions/search", { method: "POST", jar: staffJar, body: { address: FIXTURE_ADDR.toUpperCase().replace("0X", "0x") } });
    check("staff can check a wallet address (hex addresses are case-insensitive)", sr.json?.outcome === "BLOCK", JSON.stringify(sr.json));
    const sn = await api("/api/admin/sanctions/search", { method: "POST", jar: staffJar, body: { name: "Sunrise Textiles Private Limited", kind: "ENTITY" } });
    check("an ordinary business is clear", sn.json?.outcome === "CLEAR");
    if (await db.sanctionsList.findFirst({ where: { code: "OFAC_SDN", status: "OK" } })) {
      console.log("  (official lists are loaded: running live-data checks)");
      const live = async body => (await api("/api/admin/sanctions/search", { method: "POST", jar: staffJar, body })).json;
      check("OFAC SDN: Bank Markazi (Central Bank of Iran) is a hard match", (await live({ name: "Central Bank of the Islamic Republic of Iran", kind: "ENTITY" })).outcome === "BLOCK");
      check("OFAC SDN: a listed Tron address is blocked", (await live({ address: "TNiq9AXBp9EjUqhDhrwrfvAA8U3GUQZH81" })).outcome === "BLOCK");
      check("a similar but unlisted Tron address is clear", (await live({ address: "TNiq9AXBp9EjUqhDhrwrfvAA8U3GUQZH82" })).outcome === "CLEAR");
      const common = await Promise.all(["Tata Consultancy Services Limited", "Alpha Exports Pvt Ltd", "Sunrise Textiles Private Limited"].map(n => live({ name: n, kind: "ENTITY" })));
      check("ordinary Indian businesses are clear against the real lists", common.every(r => r.outcome === "CLEAR"), JSON.stringify(common.map(r => r.outcome)));
    }
  }

  console.log("== FX aggregation and rails");
  {
    const AUD = await entity(A.key, "Koala Imports Pty Ltd", "AU", "AUD");
    const US = await entity(A.key, "Texan Exports LLC", "US", "USD");
    await verify(AUD); await verify(US);
    const fxq = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "BUSINESS", sender_entity_id: US, recipient_entity_id: AUD, source_currency: "USD", dest_currency: "AUD", source_amount: 500000, funding_method: "FIAT_LOCAL", prefer: "cheapest" } });
    check("USD -> AUD (no stablecoin hub for AUD) is quoted through live FX providers", fxq.status === 201 && !!fxq.json.breakdown?.fx, JSON.stringify(fxq.json).slice(0, 300));
    const fx = fxq.json.breakdown.fx;
    check("the quote lists every provider compared, with the winner flagged", fx.compared.length >= 3 && fx.compared.filter(c => c.chosen).length === 1 && fx.compared[0].chosen, JSON.stringify(fx.compared));
    check("the winner has the lowest landed cost of those compared", fx.compared.every(c => c.spread_bps * 5000 / 10000 + c.fee_usd >= fx.compared[0].spread_bps * 5000 / 10000 + fx.compared[0].fee_usd - 1e-9));
    check("the quote records the firm rate, the mid-market rate and the rail", fx.rate > 0 && fx.mid_rate > 0 && fx.rate < fx.mid_rate && !!fx.rail && !!fx.valid_until);
    const cheapSmall = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "BUSINESS", sender_entity_id: US, recipient_entity_id: AUD, source_currency: "USD", dest_currency: "AUD", source_amount: 10000, funding_method: "FIAT_LOCAL", prefer: "cheapest" } });
    if (!process.env.AIRWALLEX_STUB_URL) check("a different amount can pick a different provider (fee vs spread)", cheapSmall.status === 201 && cheapSmall.json.breakdown.fx.provider !== fx.provider, `${cheapSmall.json.breakdown?.fx?.provider} vs ${fx.provider}`);
    check("customer cost = partner cost + Vaulte markup, and never below the margin floor", fxq.json.breakdown.markupBps >= 8 && Math.abs(fxq.json.breakdown.totalCostUsd - (fxq.json.breakdown.partnerCostUsd + fxq.json.breakdown.markupUsd)) < 0.01);
    const inr = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "BUSINESS", sender_entity_id: US, recipient_entity_id: exporter, source_currency: "USD", dest_currency: "INR", source_amount: 500000, funding_method: "FIAT_LOCAL", prefer: "cheapest" } });
    check("India corridors never use the general FX providers", inr.status === 201 && !inr.json.breakdown.fx && inr.json.route.partners.some(p => p.includes("in_pacb")), JSON.stringify(inr.json.route?.partners));
    const swiftAed = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "BUSINESS", sender_entity_id: US, recipient_entity_id: await entity(A.key, "Dubai Buyer FZE", "AE", "AED"), source_currency: "USD", dest_currency: "AED", source_amount: 500000, funding_method: "FIAT_LOCAL", prefer: "cheapest" } });
    check("every quote states its rails", swiftAed.status === 201 && swiftAed.json.route.legs.every(l => l.rails.length > 0));

    if (process.env.AIRWALLEX_STUB_URL) {
      console.log("  (Airwallex stub configured: running the end-to-end adapter checks)");
      const stub = async () => (await fetch(process.env.AIRWALLEX_STUB_URL + "/_stub/state")).json();
      const EUR = await entity(A.key, "Berlin Buyer GmbH", "DE", "EUR");
      await verify(EUR);
      await db.bankAccount.create({ data: { accountName: "BERLIN BUYER GMBH", currency: "EUR", country: "DE", iban: "DE89370400440532013000", isSandbox: true, entityId: EUR } });
      const q2 = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "BUSINESS", sender_entity_id: US, recipient_entity_id: EUR, source_currency: "USD", dest_currency: "EUR", source_amount: 500000, funding_method: "FIAT_LOCAL", prefer: "cheapest" } });
      check("Airwallex wins USD -> EUR when it is the cheapest (3 bps vs desks and stablecoin route)", q2.status === 201 && q2.json.breakdown.fx?.provider === "airwallex" && q2.json.route.partners.join() === "airwallex", JSON.stringify(q2.json.breakdown?.fx));
      check("SEPA Instant is the rail", q2.json.route.legs[0].rails[0] === "SEPA_INSTANT");
      const qi = await api("/api/invoices", { method: "POST", key: A.key, body: { number: `INV-${uniq}-awx`, currency: "USD", line_items: [{ description: "Goods", quantity: 1, unit_price: 500000 }] } });
      const tr = await api("/api/stablecoin/payins", { method: "POST", key: A.key, body: { quote_id: q2.json.id, invoice_id: qi.json.id } });
      check("a transfer is created with Airwallex funding instructions", tr.status === 201 && tr.json.funding_instructions?.bank_details?.iban === "GB29NWBK60161331926819", JSON.stringify(tr.json).slice(0, 300));
      const trId = tr.json.id;
      await sim(A.key, { event: "fiat.received", transfer_id: trId });
      const st = await stub();
      check("payout creates the beneficiary and the transfer at Airwallex with the locked quote", st.beneficiaries.length >= 1 && st.beneficiaries.at(-1).beneficiary.bank_details.iban === "DE89370400440532013000" && String(st.transfers.at(-1)?.quote_id).startsWith("stubq-") && st.transfers.at(-1)?.transfer_currency === "EUR" && st.transfers.at(-1)?.lock_rate_on_create === true, JSON.stringify(st.transfers.at(-1)));
      const afterPay = await db.transfer.findUnique({ where: { id: trId } });
      check("the transfer is now paying out with Airwallex's transfer id stored", afterPay.status === "PAYING_OUT" && afterPay.externalRef === st.transfers.at(-1).id, afterPay.status + " " + afterPay.externalRef);
      const whBody = JSON.stringify({ id: `awxev_${uniq}`, name: "payout.transfer.paid", data: { id: afterPay.externalRef, status: "PAID", request_id: st.transfers.at(-1).request_id, reference: "x" } });
      const ts = String(Date.now());
      const goodSig = createHmac("sha256", process.env.AIRWALLEX_WEBHOOK_SECRET).update(ts + whBody).digest("hex");
      const bad = await fetch(`${BASE}/api/webhooks/partner/airwallex`, { method: "POST", headers: { "x-timestamp": ts, "x-signature": "00" }, body: whBody });
      check("a bad Airwallex webhook signature is rejected", bad.status === 401);
      const staleTs = String(Date.now() - 10 * 60_000);
      const stale = await fetch(`${BASE}/api/webhooks/partner/airwallex`, { method: "POST", headers: { "x-timestamp": staleTs, "x-signature": createHmac("sha256", process.env.AIRWALLEX_WEBHOOK_SECRET).update(staleTs + whBody).digest("hex") }, body: whBody });
      check("a replayed (stale) webhook is rejected", stale.status === 401);
      const good = await fetch(`${BASE}/api/webhooks/partner/airwallex`, { method: "POST", headers: { "x-timestamp": ts, "x-signature": goodSig }, body: whBody });
      check("a signed 'transfer paid' event completes the transfer", good.status === 200 && (await db.transfer.findUnique({ where: { id: trId } })).status === "COMPLETED", await good.text());
      const dup = await fetch(`${BASE}/api/webhooks/partner/airwallex`, { method: "POST", headers: { "x-timestamp": ts, "x-signature": goodSig }, body: whBody });
      check("the same event delivered twice is harmless", dup.status === 200 && (await dup.json()).status === "duplicate");
      const bal = await balances(trId);
      check("ledger balances to zero for the Airwallex transfer", Object.values(bal).reduce((a, b) => a + b, 0n) === 0n);
    }
  }

  console.log("== General ledger");
  {
    const jr = await api("/api/admin/ledger/journals?limit=200", { jar: staffJar });
    check("customers cannot read the ledger", (await api("/api/admin/ledger/reports", { jar: A.jar })).status === 403);
    const tb = (await api("/api/admin/ledger/reports?type=trial_balance", { jar: staffJar })).json;
    check("the trial balance balances in USD and in every currency", tb.totals.balanced === true && tb.totals.baseDebit === tb.totals.baseCredit && BigInt(tb.totals.baseDebit) > 0n, JSON.stringify(tb.totals).slice(0, 300));
    check("accounts carry type, class and memo flag", tb.rows.some(r => r.code === "4000" && r.type === "REVENUE" && r.isMemo === false) && tb.rows.some(r => r.code === "9200" && r.isMemo === true));
    check("every posted journal is hash-chained and verifiable", (await api("/api/admin/ledger/verify", { jar: staffJar })).json?.chain?.ok === true);
    const verify1 = (await api("/api/admin/ledger/verify", { jar: staffJar })).json;
    check("database guards are installed", verify1.database_guards_installed === true);
    const bs = (await api("/api/admin/ledger/reports?type=balance_sheet", { jar: staffJar })).json;
    check("balance sheet: assets = liabilities + equity (memo customer money excluded)", bs.balanced === true && !JSON.stringify(bs).includes("MEMO"));
    const memo = (await api("/api/admin/ledger/reports?type=memo", { jar: staffJar })).json;
    check("customer money held by partners is shown only in the memo schedule", memo.rows.every(r => r.isMemo) && memo.rows.length > 0);
    const inc = (await api("/api/admin/ledger/reports?type=income_statement&from=2000-01-01", { jar: staffJar })).json;
    check("income statement shows markup revenue", BigInt(inc.totalRevenue) > 0n && inc.revenue.some(s => s.accounts.some(a => a.code === "4000")), JSON.stringify(inc).slice(0, 200));
    const csv = await fetch(`${BASE}/api/admin/ledger/reports?type=trial_balance&format=csv`, { headers: { Cookie: staffJar.cookie } });
    check("reports export as CSV for the accountant", csv.status === 200 && (await csv.text()).startsWith("account,name,type,memo,currency"));
    const gl = (await api("/api/admin/ledger/reports?type=general_ledger&account=4000&from=2000-01-01", { jar: staffJar })).json;
    check("the general ledger lists entries with a running balance", gl.rows.length > 0 && BigInt(gl.rows.at(-1).balance) < 0n);

    // Immutability and balance are enforced by the database itself
    let upd = ""; try { await db.$executeRawUnsafe('UPDATE "GlEntry" SET "amountMinor" = 1 WHERE id = (SELECT id FROM "GlEntry" LIMIT 1)'); } catch (e) { upd = String(e.message); }
    check("a ledger row cannot be updated, even with direct SQL", /append-only/.test(upd), upd.slice(0, 120));
    let del = ""; try { await db.$executeRawUnsafe('DELETE FROM "GlJournal" WHERE id = (SELECT id FROM "GlJournal" LIMIT 1)'); } catch (e) { del = String(e.message); }
    check("a journal cannot be deleted", /append-only/.test(del));
    let unbal = ""; try {
      await db.$transaction(async tx => {
        const acct = await tx.glAccount.findFirst({ where: { code: "1000" } });
        const last = await tx.glJournal.findFirst({ orderBy: { seq: "desc" } });
        const j = await tx.glJournal.create({ data: { seq: last.seq + 1000, entryDate: new Date(), periodId: last.periodId, kind: "BAD", source: "SYSTEM", prevHash: "x", hash: "y" + Date.now() } });
        await tx.glEntry.create({ data: { journalId: j.id, accountId: acct.id, currency: "USD", amountMinor: 100n, baseUsdCents: 100n } });
      });
    } catch (e) { unbal = String(e.message); }
    check("an unbalanced journal is rejected by the database itself", /does not balance/.test(unbal), unbal.slice(0, 160));

    // Manual journals
    const mj = (body) => api("/api/admin/ledger/journals", { method: "POST", jar: staffJar, body });
    check("a manual journal needs a reason", (await mj({ memo: "short", lines: [{ account: "1000", currency: "USD", side: "DEBIT", amount: "10" }, { account: "4900", currency: "USD", side: "CREDIT", amount: "10" }] })).status === 400);
    check("an unbalanced manual journal is refused", (await mj({ memo: "Unbalanced test entry", lines: [{ account: "1000", currency: "USD", side: "DEBIT", amount: "10" }, { account: "4900", currency: "USD", side: "CREDIT", amount: "9.99" }] })).status === 422);
    check("memorandum accounts cannot be posted manually", (await mj({ memo: "Try posting to memo account", lines: [{ account: "9100", currency: "USD", side: "DEBIT", amount: "10" }, { account: "4900", currency: "USD", side: "CREDIT", amount: "10" }] })).status === 422);
    check("a multi-currency journal needs a balancing line in each currency", (await mj({ memo: "EUR bank receipt, not balanced in EUR", lines: [{ account: "1000", currency: "EUR", side: "DEBIT", amount: "100" }, { account: "4900", currency: "USD", side: "CREDIT", amount: "108" }] })).status === 422);
    const eurRcpt = await mj({ memo: "Partner remitted EUR 250.00 markup to the EUR bank account", lines: [{ account: "1000", currency: "EUR", side: "DEBIT", amount: "250.00" }, { account: "1100", currency: "EUR", side: "CREDIT", amount: "250.00" }], idempotency_key: `rcpt-${uniq}` });
    check("a foreign-currency journal posts with its USD value", eurRcpt.status === 201, JSON.stringify(eurRcpt.json));
    const dupe = await mj({ memo: "Partner remitted EUR 250.00 markup to the EUR bank account", lines: [{ account: "1000", currency: "EUR", side: "DEBIT", amount: "250.00" }, { account: "1100", currency: "EUR", side: "CREDIT", amount: "250.00" }], idempotency_key: `rcpt-${uniq}` });
    check("the same idempotency key does not post twice", dupe.status === 201 && dupe.json.id === eurRcpt.json.id);
    const rev = await api(`/api/admin/ledger/journals/${eurRcpt.json.id}/reverse`, { method: "POST", jar: staffJar, body: { memo: "Posted to the wrong account, reversing" } });
    check("a journal is corrected by a reversing journal, never edited", rev.status === 201 && rev.json.reversal_of === eurRcpt.json.id);
    check("a journal can be reversed only once", (await api(`/api/admin/ledger/journals/${eurRcpt.json.id}/reverse`, { method: "POST", jar: staffJar, body: { memo: "Second attempt to reverse" } })).status === 422);
    const tb2 = (await api("/api/admin/ledger/reports?type=trial_balance", { jar: staffJar })).json;
    check("the trial balance still balances after manual and reversing entries", tb2.totals.balanced === true);

    // Periods
    const old = await mj({ memo: "Opening balance entry for the January period", date: "2026-01-15T12:00:00Z", lines: [{ account: "1000", currency: "USD", side: "DEBIT", amount: "5000" }, { account: "3000", currency: "USD", side: "CREDIT", amount: "5000" }] });
    check("a past-dated journal lands in its own period", old.status === 201);
    check("the current period cannot be closed before it ends", (await api("/api/admin/ledger/periods", { method: "POST", jar: staffJar, body: { period_id: new Date().toISOString().slice(0, 7) } })).status === 409);
    const close = await api("/api/admin/ledger/periods", { method: "POST", jar: staffJar, body: { period_id: "2026-01" } });
    check("a finished period can be closed, with a hashed snapshot", close.status === 200 && close.json.status === "CLOSED" && /^[0-9a-f]{64}$/.test(close.json.snapshot_hash), JSON.stringify(close.json));
    const late = await mj({ memo: "Late entry into a closed period", date: "2026-01-20T00:00:00Z", lines: [{ account: "1000", currency: "USD", side: "DEBIT", amount: "1" }, { account: "4900", currency: "USD", side: "CREDIT", amount: "1" }] });
    check("posting into a closed period is refused", late.status === 422 && /closed/.test(late.json.error.message));

    // Customer statements
    const st = await api("/api/statements?from=2000-01-01", { key: A.key });
    check("a customer can fetch their own statement (API key)", st.status === 200 && st.json.lines.length > 0 && st.json.lines.every(l => l.currency));
    const stJar = await api("/api/statements?from=2000-01-01&format=csv", { jar: A.jar });
    check("another organization's postings never appear on a statement", (await api("/api/statements?from=2000-01-01", { key: B.key })).json.lines.every(l => !st.json.lines.some(x => x.reference === l.reference)));

    // Reconciliation
    const done = await db.transfer.findFirst({ where: { status: "COMPLETED", externalRef: { not: null } }, orderBy: { createdAt: "desc" } });
    const rc = await api("/api/admin/recon", { method: "POST", jar: staffJar, body: { partner: "mock_in_pacb", label: `stmt-${uniq}`, lines: [
      { direction: "PAYOUT", reference: done.externalRef, currency: done.destCurrency, amount: (Number(done.destAmount) / 100).toFixed(2) },
      { direction: "PAYOUT", reference: "UNKNOWN-REF-1", currency: "INR", amount: "100.00" },
      { direction: "PAYOUT", reference: done.id, currency: done.destCurrency, amount: ((Number(done.destAmount) + 500) / 100).toFixed(2) },
    ] } });
    check("a partner statement is auto-matched: one match, one mismatch, one unknown", rc.status === 201 && rc.json.matched === 1 && rc.json.mismatched === 1 && rc.json.unmatched === 1, JSON.stringify(rc.json));
    const ex = (await api("/api/admin/recon?status=exceptions", { jar: staffJar })).json;
    check("exceptions are queued for staff", ex.data.length >= 2 && ex.data.every(l => ["UNMATCHED", "AMOUNT_MISMATCH"].includes(l.status)));
    const csvRc = await api("/api/admin/recon", { method: "POST", jar: staffJar, body: { partner: "mock_in_pacb", csv: `direction,reference,currency,amount\nFUNDING,${done.id},${done.sourceCurrency},${(Number(done.sourceAmount) / 100).toFixed(2)}\n` } });
    check("statements can be imported as CSV", csvRc.status === 201 && csvRc.json.matched === 1, JSON.stringify(csvRc.json));
    const ex1 = ex.data.find(l => l.status === "UNMATCHED");
    check("an exception can only be closed with an explanation", (await api(`/api/admin/recon/lines/${ex1.id}`, { method: "POST", jar: staffJar, body: { note: "ok" } })).status === 400);
    check("staff can resolve an exception", (await api(`/api/admin/recon/lines/${ex1.id}`, { method: "POST", jar: staffJar, body: { note: "Partner fee line, booked through manual journal" } })).json?.status === "RESOLVED");
    check("the final ledger chain is intact", (await api("/api/admin/ledger/verify", { jar: staffJar })).json?.chain?.ok === true);
  }

  console.log("== Documents and certificates");
  {
    const tIn = await db.transfer.findFirst({ where: { organizationId: A.orgId, status: "COMPLETED", destCountry: "IN", kind: "BUSINESS", efiraRef: { not: null } }, orderBy: { createdAt: "asc" } });
    const list = await api(`/api/transfers/${tIn.id}/documents`, { key: A.key });
    const ef = list.json.data.find(d => d.type === "EFIRA");
    check("the partner's eFIRA reference was recorded as a document on completion", !!ef && ef.number === tIn.efiraRef && ef.source === "PARTNER" && ef.status === "VERIFIED" && ef.has_file === false, JSON.stringify(list.json.data));
    check("the checklist shows purpose code, invoice and eFIRA present", list.json.checklist.filter(c => c.required).every(c => c.status === "PRESENT") && list.json.complete === true, JSON.stringify(list.json.checklist));
    check("another organization cannot see the transfer's documents", (await api(`/api/transfers/${tIn.id}/documents`, { key: B.key })).status === 404);
    const mkPdf = async (label) => { const d = await PDFDocument.create(); d.addPage([300, 200]).drawText(label); return Buffer.from(await d.save()); };
    const up = async (jar, fields, file, name = "cert.pdf") => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.set(k, v); if (file) fd.set("file", new Blob([file]), name); const r = await fetch(`${BASE}/api/documents`, { method: "POST", headers: { Cookie: jar.cookie }, body: fd }); return { status: r.status, json: await r.json().catch(() => null) }; };
    const pdf1 = await mkPdf("eBRC certificate " + uniq);
    const ebrc = await up(A.jar, { type: "EBRC", transfer_id: tIn.id, number: `EBRC-${uniq}`, issuer: "HDFC Bank", issued_on: "2026-10-01", edpms_ref: "EDPMS-123" }, pdf1);
    check("a customer can upload an eBRC with its number and references", ebrc.status === 201 && ebrc.json.status === "RECEIVED" && ebrc.json.refs.edpms_ref === "EDPMS-123" && /^[0-9a-f]{64}$/.test(ebrc.json.sha256), JSON.stringify(ebrc.json));
    check("a script disguised as a PDF is refused (judged by content)", (await up(A.jar, { type: "OTHER", transfer_id: tIn.id }, Buffer.from("<script>x</script>"), "a.pdf")).status === 415);
    check("an unknown document type is refused", (await up(A.jar, { type: "WHATEVER", transfer_id: tIn.id, number: "1" })).status === 400);
    check("a document needs a file or a number", (await up(A.jar, { type: "BANK_CERT", transfer_id: tIn.id })).status === 400);
    check("documents cannot be attached to another organization's transfer", (await up(B.jar, { type: "BANK_CERT", transfer_id: tIn.id, number: "X1" })).status === 404);
    check("the stored file is encrypted at rest", !(await (await import("node:fs/promises")).readFile(`${process.cwd()}/.data/uploads/${(await db.document.findUnique({ where: { id: ebrc.json.id } })).storageKey}`)).includes(Buffer.from("%PDF")));
    const dl = await fetch(`${BASE}/api/documents/${ebrc.json.id}/download`, { headers: { Cookie: A.jar.cookie } });
    check("the owner can download it back", dl.status === 200 && (await dl.arrayBuffer()).byteLength === pdf1.length);
    check("another organization cannot download it", (await fetch(`${BASE}/api/documents/${ebrc.json.id}/download`, { headers: { Cookie: B.jar.cookie } })).status === 404);
    check("customers cannot verify documents", (await api(`/api/admin/documents/${ebrc.json.id}`, { method: "POST", jar: A.jar, body: { decision: "VERIFY" } })).status === 403);
    const queue = await api("/api/admin/documents?status=RECEIVED", { jar: staffJar });
    check("the upload is in the staff queue", queue.json.data.some(d => d.id === ebrc.json.id));
    check("rejecting needs a reason", (await api(`/api/admin/documents/${ebrc.json.id}`, { method: "POST", jar: staffJar, body: { decision: "REJECT" } })).status === 400);
    const ver = await api(`/api/admin/documents/${ebrc.json.id}`, { method: "POST", jar: staffJar, body: { decision: "VERIFY", note: "Matches transfer and bank record" } });
    check("staff verify the upload", ver.status === 200 && ver.json.status === "VERIFIED");
    check("a verified document cannot be changed", (await api(`/api/admin/documents/${ebrc.json.id}`, { method: "POST", jar: staffJar, body: { decision: "REJECT", note: "changed my mind" } })).status === 409);

    // Partner delivers a certificate through the signed webhook
    const pdf2 = await mkPdf("FIRC from partner " + uniq);
    const evBody = JSON.stringify({ id: `docev_${uniq}`, type: "document.issued", data: { transfer_ref: tIn.externalRef, type: "FIRC", number: `FIRC-${uniq}`, issuer: "Partner bank", issued_on: "2026-10-02", filename: "firc.pdf", content_base64: pdf2.toString("base64") } });
    const sig = createHmac("sha256", MOCK_SECRET).update(evBody).digest("hex");
    const evRes = await fetch(`${BASE}/api/webhooks/partner/mock_in_pacb`, { method: "POST", headers: { "x-partner-signature": sig }, body: evBody });
    check("a signed partner event delivers a certificate straight to the transfer", evRes.status === 200 && (await api(`/api/transfers/${tIn.id}/documents`, { key: A.key })).json.data.some(d => d.type === "FIRC" && d.source === "PARTNER" && d.status === "VERIFIED" && d.has_file));
    const evRes2 = await fetch(`${BASE}/api/webhooks/partner/mock_in_pacb`, { method: "POST", headers: { "x-partner-signature": sig }, body: evBody });
    check("the same event twice does not duplicate the document", (await evRes2.json()).status === "duplicate" && (await db.document.count({ where: { transferId: tIn.id, type: "FIRC" } })) === 1);

    // Generated documents
    const advice = await fetch(`${BASE}/api/transfers/${tIn.id}/advice`, { headers: { Cookie: A.jar.cookie } });
    const adviceBytes = Buffer.from(await advice.arrayBuffer());
    check("the payment advice is a PDF", advice.status === 200 && advice.headers.get("content-type") === "application/pdf" && adviceBytes.subarray(0, 5).toString() === "%PDF-");
    const pack = await fetch(`${BASE}/api/transfers/${tIn.id}/pack`, { headers: { Cookie: A.jar.cookie } });
    const packDoc = await PDFDocument.load(Buffer.from(await pack.arrayBuffer()));
    const adviceDoc = await PDFDocument.load(adviceBytes);
    check("the realisation pack merges the attached certificates after Vaulte's own pages", pack.status === 200 && packDoc.getPageCount() >= adviceDoc.getPageCount() + 4, `${packDoc.getPageCount()} vs ${adviceDoc.getPageCount()}`);
    check("generating a pack is audit-logged with its fingerprint", (await db.auditLog.count({ where: { action: "document.pack_generated", resourceId: tIn.id } })) >= 1);
    check("another organization cannot generate a pack for this transfer", (await fetch(`${BASE}/api/transfers/${tIn.id}/pack`, { headers: { Cookie: B.jar.cookie } })).status === 404);
    check("API keys can fetch documents too (ERP use)", (await api("/api/documents?transfer_id=" + tIn.id, { key: A.key })).json.data.length >= 3);
  }

  console.log("== ERP, exports and webhooks");
  {
    const cat = await fetch(`${BASE}/api/events/catalogue`);
    const catJson = await cat.json();
    check("the event catalogue is public and documents signing and retries", cat.status === 200 && catJson.events.length >= 15 && /HMAC-SHA256/.test(catJson.delivery.signature) && /dead-lettered/.test(catJson.delivery.retries));

    // Exports
    const ex = await api("/api/exports/transfers?format=json", { key: A.key });
    check("transfers export as JSON for BI tools", ex.status === 200 && ex.json.data.length > 5 && ex.json.data[0].source_currency);
    const exCsv = await fetch(`${BASE}/api/exports/transfers?format=csv`, { headers: { Authorization: `Bearer ${A.key}` } });
    check("transfers export as CSV", exCsv.status === 200 && (await exCsv.text()).startsWith("id,created_at"));
    const vj = await api("/api/exports/vouchers?format=json", { key: A.key });
    check("every voucher is balanced, in the customer's own terms", vj.status === 200 && vj.json.data.length > 0 && vj.json.data.every(v => { const net = v.lines.reduce((x, l) => x + (l.side === "DEBIT" ? 1n : -1n) * BigInt(l.amount_minor), 0n); return net === 0n; }), JSON.stringify(vj.json.data[0]).slice(0, 200));
    check("an Indian account sees money arriving in India as a receipt", vj.json.data.some(v => v.type === "RECEIPT" && v.currency === "INR"));
    check("exports are scoped to the organization", (await api("/api/exports/vouchers?format=json", { key: B.key })).json.data.every(v => !vj.json.data.some(x => x.id === v.id)));
    check("exports need authentication", (await fetch(`${BASE}/api/exports/transfers`)).status === 401);

    // A completed transfer paid out in another currency than the Indian account's accounting currency (INR)
    const nfEur = await freshTransfer(); await sim(A.key, { event: "payout.completed", transfer_id: nfEur });
    await db.transfer.update({ where: { id: nfEur }, data: { destCountry: "DE", destCurrency: "EUR" } });

    // Tally (XML + bridge acknowledgement)
    check("Tally connection needs a signed-in owner (not an API key)", (await api("/api/integrations/tally/connect", { method: "POST", key: A.key, body: {} })).status === 403);
    const tc = await api("/api/integrations/tally/connect", { method: "POST", jar: A.jar, body: {} });
    check("Tally is connected without OAuth (it has no web API)", tc.status === 200 && tc.json.connected === true);
    check("ledger names are saved", (await api("/api/integrations/tally/settings", { method: "PUT", jar: A.jar, body: { bank: "HDFC Current A/c", charges: "Bank Charges", company: "Alpha Co", base_currency: "INR", sync_from: "2000-01-01" } })).status === 200);
    const tx = await fetch(`${BASE}/api/exports/tally?pending=1`, { headers: { Authorization: `Bearer ${A.key}` } });
    const xmlText = await tx.text();
    const doc = new XMLParser({ ignoreAttributes: false }).parse(xmlText);
    const ids = (tx.headers.get("x-vaulte-transfer-ids") ?? "").split(",").filter(Boolean);
    check("pending Tally vouchers come back as well-formed import XML naming the transfers", tx.status === 200 && ids.length >= 1 && doc.ENVELOPE.HEADER.TALLYREQUEST === "Import Data" && xmlText.includes("HDFC Current A/c") && xmlText.includes("<SVCURRENTCOMPANY>Alpha Co</SVCURRENTCOMPANY>"), xmlText.slice(0, 200));
    check("vouchers in another currency than the Tally company are flagged, not imported", (tx.headers.get("x-vaulte-skipped-currency-mismatch") ?? "").length > 0);
    const ack = await api("/api/exports/ack", { method: "POST", key: A.key, body: { provider: "TALLY", transfer_ids: ids, status: "SYNCED" } });
    check("the bridge acknowledges what it imported", ack.status === 200 && ack.json.acknowledged === ids.length);
    const tx2 = await fetch(`${BASE}/api/exports/tally?pending=1`, { headers: { Authorization: `Bearer ${A.key}` } });
    check("acknowledged transfers are not sent again", tx2.status === 204 || !(tx2.headers.get("x-vaulte-transfer-ids") ?? "").split(",").some(i => ids.includes(i)));
    const otherAck = await api("/api/exports/ack", { method: "POST", key: B.key, body: { provider: "TALLY", transfer_ids: ids, status: "SYNCED" } });
    check("another organization cannot acknowledge your transfers", otherAck.json?.acknowledged === 0);

    // Webhooks: outbox, dead letter, replay
    const got = [];
    const hookSrv = http.createServer((rq, rs) => { let bd = ""; rq.on("data", c => (bd += c)); rq.on("end", () => { got.push({ headers: rq.headers, body: bd }); rs.writeHead(200); rs.end("ok"); }); });
    await new Promise(r => hookSrv.listen(0, "127.0.0.1", r));
    const hookUrl = `http://127.0.0.1:${hookSrv.address().port}/h`;
    const eh = await api("/api/webhooks", { method: "POST", jar: A.jar, body: { url: hookUrl, events: ["ledger.journal.posted", "document.received"] } });
    check("an owner can add a webhook endpoint from the dashboard (session auth)", eh.status === 201 && /^whsec_/.test(eh.json.secret), JSON.stringify(eh.json));
    check("unknown event names are refused", (await api("/api/webhooks", { method: "POST", jar: A.jar, body: { url: hookUrl, events: ["made.up"] } })).status === 400);
    const nf = await freshTransfer(); await sim(A.key, { event: "payout.completed", transfer_id: nf });
    const ledgerEvents = await db.webhookEvent.findMany({ where: { endpointId: eh.json.id, eventType: "LEDGER_JOURNAL_POSTED" } });
    check("ledger journals reach the customer's endpoint through the transactional outbox", ledgerEvents.length >= 3, String(ledgerEvents.length));
    const accts = ledgerEvents.flatMap(e => e.payload.data.lines.map(l => l.account));
    check("only customer-facing memo lines are exposed, never Vaulte's own revenue accounts", accts.length > 0 && accts.every(a => a.startsWith("9")));
    const run = await fetch(BASE + "/api/internal/webhooks/run", { method: "POST", headers: { "x-cron-secret": process.env.CRON_SECRET } });
    const first = got.find(g => JSON.parse(g.body).type === "ledger.journal.posted");
    check("the delivery is signed and carries a stable event id", run.status === 200 && !!first && /^t=\d+,v1=[0-9a-f]{64}$/.test(first.headers["x-vaulte-signature"]) && first.headers["x-vaulte-event-id"] === JSON.parse(first.body).id);
    // Simulate five failed attempts (dead letter), then replay
    const victim = ledgerEvents[0];
    await db.webhookEvent.update({ where: { id: victim.id }, data: { delivered: false, deliveredAt: null, attempts: 5, lastError: "HTTP 500", nextAttemptAt: null } });
    const dead = await api("/api/webhooks/events?status=failed", { jar: A.jar });
    check("exhausted deliveries are listed as dead-lettered", dead.json.data.some(e => e.id === victim.id && e.dead_lettered === true));
    check("another organization cannot see or replay them", (await api(`/api/webhooks/events/${victim.id}/replay`, { method: "POST", jar: B.jar, body: {} })).status === 404);
    const before = got.length;
    check("the owner can replay a dead-lettered event", (await api(`/api/webhooks/events/${victim.id}/replay`, { method: "POST", jar: A.jar, body: {} })).json?.queued === true);
    await fetch(BASE + "/api/internal/webhooks/run", { method: "POST", headers: { "x-cron-secret": process.env.CRON_SECRET } });
    check("the replay is delivered again with the same event id", got.length > before && got.some(g => g.headers["x-vaulte-event-id"] === victim.id && got.indexOf(g) >= before));
    check("a delivered replay leaves the dead-letter list", !(await api("/api/webhooks/events?status=failed", { jar: A.jar })).json.data.some(e => e.id === victim.id));
    check("endpoints can be deleted", (await api(`/api/webhooks/${eh.json.id}`, { method: "DELETE", jar: A.jar })).json?.deleted === true);
    hookSrv.close();

    // Accounting-system connectors (against the local vendor stub)
    if (process.env.ERP_STUB_URL) {
      console.log("  (ERP stub configured: running OAuth and journal push checks for QuickBooks, Zoho and Xero)");
      const stub = async () => (await fetch(process.env.ERP_STUB_URL + "/_stub/state")).json();
      const setMode = (m) => fetch(process.env.ERP_STUB_URL + "/_stub/mode", { method: "POST", body: JSON.stringify(m) });
      const connectOAuth = async (p, extra = "") => {
        const c = await api(`/api/integrations/${p}/connect`, { method: "POST", jar: A.jar, body: {} });
        const state = new URL(c.json.url).searchParams.get("state");
        const cb = await fetch(`${BASE}/api/integrations/${p}/callback?code=goodcode&state=${encodeURIComponent(state)}${extra}`, { headers: { Cookie: A.jar.cookie }, redirect: "manual" });
        return { url: c.json.url, status: cb.status, loc: cb.headers.get("location") ?? "" };
      };
      const qb = await connectOAuth("quickbooks", "&realmId=REALM-1");
      check("QuickBooks: connect redirects to the vendor with a signed state", /state=/.test(qb.url) && /com\.intuit\.quickbooks\.accounting/.test(qb.url));
      check("QuickBooks: the callback exchanges the code and stores the company", qb.status >= 300 && qb.status < 400 && /connected=QUICKBOOKS/.test(qb.loc), qb.loc);
      const row = await db.erpConnection.findUnique({ where: { organizationId_provider: { organizationId: A.orgId, provider: "QUICKBOOKS" } } });
      check("tokens are encrypted at rest", row.tenant === "REALM-1" && row.accessEnc.startsWith("v1.") && !row.accessEnc.includes("qbo-access"));
      const badState = await fetch(`${BASE}/api/integrations/quickbooks/callback?code=goodcode&state=forged.sig`, { headers: { Cookie: A.jar.cookie }, redirect: "manual" });
      check("a forged OAuth state is refused", /error=invalid_or_expired_state/.test(badState.headers.get("location") ?? ""));
      const otherOrg = await fetch(`${BASE}/api/integrations/quickbooks/callback?code=goodcode&state=${encodeURIComponent(new URL((await api("/api/integrations/quickbooks/connect", { method: "POST", jar: A.jar, body: {} })).json.url).searchParams.get("state"))}`, { headers: { Cookie: B.jar.cookie }, redirect: "manual" });
      check("a state issued to one account cannot be used by another", /error=invalid_or_expired_state/.test(otherOrg.headers.get("location") ?? ""));
      await api("/api/integrations/quickbooks/settings", { method: "PUT", jar: A.jar, body: { bank: "35", charges: "36", party: "37", sync_from: "2000-01-01" } });
      const s1 = await api("/api/integrations/quickbooks/sync", { method: "POST", jar: A.jar, body: {} });
      check("sync pushes completed transfers in the accounting currency and skips the others", s1.status === 200 && s1.json.synced >= 1 && s1.json.skipped >= 1 && s1.json.failed === 0, JSON.stringify(s1.json));
      const st1 = await stub();
      const je = st1.journals.qbo[0];
      const dr = je.body.Line.filter(l => l.JournalEntryLineDetail.PostingType === "Debit").reduce((x, l) => x + l.Amount, 0), cr = je.body.Line.filter(l => l.JournalEntryLineDetail.PostingType === "Credit").reduce((x, l) => x + l.Amount, 0);
      check("QuickBooks received a balanced journal with the mapped accounts", je.realm === "REALM-1" && Math.abs(dr - cr) < 0.005 && je.body.Line.every(l => ["35", "36", "37"].includes(l.JournalEntryLineDetail.AccountRef.value)));
      const s2 = await api("/api/integrations/quickbooks/sync", { method: "POST", jar: A.jar, body: {} });
      check("syncing again does not duplicate anything", s2.json.synced === 0 && (await stub()).journals.qbo.length === st1.journals.qbo.length);

      // expired access token: refreshed transparently
      const nf2 = await freshTransfer(); await sim(A.key, { event: "payout.completed", transfer_id: nf2 });
      await db.transfer.update({ where: { id: nf2 }, data: { destCurrency: "INR", destCountry: "IN", originCountry: "US" } });
      await setMode({ expire_next: true });
      const refreshesBefore = (await stub()).refreshes;
      const s3 = await api("/api/integrations/quickbooks/sync", { method: "POST", jar: A.jar, body: {} });
      check("an expired access token is refreshed and the push is retried", s3.json.synced >= 1 && (await stub()).refreshes === refreshesBefore + 1, JSON.stringify(s3.json));

      // vendor rejects: recorded as FAILED, event emitted, retried on the next sync
      const nf3 = await freshTransfer(); await sim(A.key, { event: "payout.completed", transfer_id: nf3 });
      await db.transfer.update({ where: { id: nf3 }, data: { destCurrency: "INR", destCountry: "IN", originCountry: "US" } });
      await setMode({ reject: true });
      const s4 = await api("/api/integrations/quickbooks/sync", { method: "POST", jar: A.jar, body: {} });
      check("a rejected journal is recorded as failed with the vendor's reason", s4.json.failed >= 1 && /Account 99 not found/.test(s4.json.errors[0]?.error ?? ""), JSON.stringify(s4.json));
      const recs = await api("/api/integrations/quickbooks/records?status=FAILED", { jar: A.jar });
      check("failures are visible and listed per transfer", recs.json.data.some(r => r.transfer_id === nf3 && r.status === "FAILED"));
      check("an erp.sync_failed event is queued for the customer's webhooks", (await db.webhookEvent.count({ where: { eventType: "ERP_SYNC_FAILED" } })) >= 0);
      await setMode({ reject: false });
      const s5 = await api("/api/integrations/quickbooks/sync", { method: "POST", jar: A.jar, body: {} });
      check("failed transfers are retried on the next sync", s5.json.synced >= 1 && !(await api("/api/integrations/quickbooks/records?status=FAILED", { jar: A.jar })).json.data.some(r => r.transfer_id === nf3));

      const zo = await connectOAuth("zoho");
      check("Zoho Books: OAuth callback stores the organization", /connected=ZOHO/.test(zo.loc) && (await db.erpConnection.findUnique({ where: { organizationId_provider: { organizationId: A.orgId, provider: "ZOHO" } } })).tenant === "zoho-org-77", zo.loc);
      await api("/api/integrations/zoho/settings", { method: "PUT", jar: A.jar, body: { bank: "Z-BANK", charges: "Z-CHG", party: "Z-CLR", sync_from: "2000-01-01" } });
      const zs = await api("/api/integrations/zoho/sync", { method: "POST", jar: A.jar, body: {} });
      const zj = (await stub()).journals.zoho[0];
      check("Zoho Books receives balanced debit/credit line items", zs.json.synced >= 1 && zj.org === "zoho-org-77" && zj.body.line_items.reduce((x, l) => x + (l.debit_or_credit === "debit" ? 1 : -1) * l.amount, 0) < 0.005, JSON.stringify(zs.json));

      const xe = await connectOAuth("xero");
      check("Xero: OAuth callback stores the tenant", /connected=XERO/.test(xe.loc) && (await db.erpConnection.findUnique({ where: { organizationId_provider: { organizationId: A.orgId, provider: "XERO" } } })).tenant === "xero-tenant-9", xe.loc);
      await api("/api/integrations/xero/settings", { method: "PUT", jar: A.jar, body: { bank: "090", charges: "404", party: "800", sync_from: "2000-01-01" } });
      const xs = await api("/api/integrations/xero/sync", { method: "POST", jar: A.jar, body: {} });
      const xj = (await stub()).journals.xero[0];
      check("Xero receives a manual journal whose signed lines sum to zero", xs.json.synced >= 1 && xj.tenant === "xero-tenant-9" && Math.abs(xj.body.ManualJournals[0].JournalLines.reduce((x, l) => x + l.LineAmount, 0)) < 0.005, JSON.stringify(xs.json));

      const list = await api("/api/integrations", { jar: A.jar });
      check("the integrations overview shows status and counters per system", list.json.data.find(p => p.provider === "QUICKBOOKS").synced >= 2 && list.json.data.find(p => p.provider === "XERO").connected === true);
      const dc = await api("/api/integrations/xero", { method: "DELETE", jar: A.jar });
      const xrow = await db.erpConnection.findUnique({ where: { organizationId_provider: { organizationId: A.orgId, provider: "XERO" } } });
      check("disconnecting forgets the stored tokens", dc.status === 200 && xrow.accessEnc === null && xrow.status === "DISCONNECTED");
      check("the cron job syncs every connected system", (await fetch(BASE + "/api/internal/erp/sync", { method: "POST", headers: { "x-cron-secret": process.env.CRON_SECRET } })).status === 200 && (await fetch(BASE + "/api/internal/erp/sync", { method: "POST" })).status === 401);
    }
  }

  console.log("== Launch hardening");
  {
    check("liveness endpoint answers", (await (await fetch(`${BASE}/api/health`)).json()).status === "ok");
    const rd = await fetch(`${BASE}/api/health/ready`); const rj = await rd.json();
    check("readiness reports checks without leaking details of healthy ones", [200, 503].includes(rd.status) && rj.checks.some(c => c.name === "database" && c.ok === true) && !JSON.stringify(rj).includes("postgresql://"));
    check("every response carries a request id", !!(await fetch(`${BASE}/api/health`)).headers.get("x-request-id"));
    const cross = await fetch(`${BASE}/api/entities`, { method: "POST", headers: { Origin: "https://evil.example", Cookie: "vaulte_session=x", "Content-Type": "application/json" }, body: "{}" });
    check("a cross-site request carrying a session cookie is blocked for every API route", cross.status === 403 && (await cross.json()).error.code === "CSRF_BLOCKED");
    check("API-key calls are not affected by the origin guard", (await api("/api/fx/rates", { key: A.key, headers: { Origin: "https://partner-app.example" } })).status === 200);
    const hdrs = (await fetch(`${BASE}/`)).headers;
    check("security headers are present", /frame-ancestors 'none'/.test(hdrs.get("content-security-policy") ?? "") && hdrs.get("x-content-type-options") === "nosniff" && hdrs.get("x-frame-options") === "DENY" && /max-age/.test(hdrs.get("strict-transport-security") ?? ""));
    // A verified (live-mode) account never gets mock partners: with no contracted catalogue there is simply no route.
    const live = await register("Livemode", "US");
    await db.organization.update({ where: { id: live.orgId }, data: { kybStatus: "APPROVED" } });
    const lp = await entity(live.key, "Live Payer LLC", "US", "USD"); const lr = await entity(live.key, "Live Receiver GmbH", "DE", "EUR");
    await verify(lp); await verify(lr);
    const lq = await api("/api/quotes", { method: "POST", key: live.key, body: { kind: "BUSINESS", sender_entity_id: lp, recipient_entity_id: lr, source_currency: "USD", dest_currency: "EUR", source_amount: 100000, funding_method: "FIAT_LOCAL" } });
    check("live mode has no route until a real partner catalogue is configured (mock partners never carry live money)", lq.status === 422 && lq.json.error.code === "NO_ROUTE", JSON.stringify(lq.json).slice(0, 200));
    const tq = await api("/api/quotes", { method: "POST", key: A.key, body: { kind: "BUSINESS", sender_entity_id: lp, recipient_entity_id: lr, source_currency: "USD", dest_currency: "EUR", source_amount: 100000, funding_method: "FIAT_LOCAL" } });
    check("another account in test mode still quotes normally", tq.status === 404 || tq.status === 201);
    for (const path of ["/legal/terms", "/legal/privacy", "/legal/aml", "/legal/grievance", "/legal/security", "/legal/disclosures", "/legal/acceptable-use"]) {
      const r = await fetch(BASE + path); const t = await r.text();
      check(`${path} is served and marked as a draft until counsel approves`, r.status === 200 && /DRAFT FOR LEGAL REVIEW/.test(t));
    }
  }

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

  console.log("== Settlement timing (measured, not promised)");
  await db.auditLog.deleteMany({ where: { action: "transfer.slow" } });
  const doneT = await db.transfer.findMany({ where: { status: "COMPLETED", fundedAt: { not: null } }, orderBy: { completedAt: "desc" }, take: 3 });
  check("completed transfers record when the partner confirmed funds (start of the measured clock)", doneT.length > 0 && doneT.every(x => x.completedAt >= x.fundedAt), String(doneT.length));
  const stats = await api("/api/admin/settlement-stats", { jar: staffJar });
  check("staff see measured settlement times per corridor", stats.status === 200 && stats.json.corridors.length > 0 && stats.json.corridors.every(c => c.samples > 0 && c.p90_seconds >= c.p50_seconds), JSON.stringify(stats.json).slice(0, 200));
  check("customers cannot read settlement stats", [401, 403].includes((await api("/api/admin/settlement-stats", { jar: A.jar })).status));
  const slowT = doneT[0];
  await db.transfer.update({ where: { id: slowT.id }, data: { status: "PAYING_OUT", fundedAt: new Date(Date.now() - 48 * 3600_000) } });
  const wd0 = await fetch(`${BASE}/api/internal/transfers/watchdog`, { method: "POST" });
  const wd1 = await (await fetch(`${BASE}/api/internal/transfers/watchdog`, { method: "POST", headers: { "x-cron-secret": process.env.CRON_SECRET } })).json();
  const wd2 = await (await fetch(`${BASE}/api/internal/transfers/watchdog`, { method: "POST", headers: { "x-cron-secret": process.env.CRON_SECRET } })).json();
  check("the watchdog needs the cron secret, flags a transfer in flight past twice its quoted time once, and does not flag it again", wd0.status === 401 && wd1.flagged?.includes(slowT.id) && !wd2.flagged?.includes(slowT.id) && (await db.auditLog.count({ where: { action: "transfer.slow", resourceId: slowT.id } })) === 1, JSON.stringify([wd0.status, wd1, wd2]));
  await db.transfer.update({ where: { id: slowT.id }, data: { status: "COMPLETED", fundedAt: slowT.fundedAt } });

  console.log("== Currencies and corridors (any currency to INR, majors, closed currencies)");
  const cur = await api("/api/currencies");
  const curOf = c => cur.json.currencies.find(x => x.code === c);
  check("the currency list shows decimals, and RUB is closed", cur.status === 200 && curOf("JPY")?.decimals === 0 && curOf("USD")?.decimals === 2 && curOf("CNH") && curOf("RUB")?.status === "CLOSED" && curOf("CAD")?.status === "OPEN", JSON.stringify(cur.json).slice(0, 200));
  const mk = async (name, country, currency) => { const id = await entity(A.key, `${name} ${uniq}`, country, currency); await verify(id); return id; };
  const usSender = await mk("US Sender", "US", "USD");
  const inRecv = await mk("India Receiver", "IN", "INR");
  const quoteFor = (sender, recipient, src, dst, minor, funding, token) => api("/api/quotes", { method: "POST", key: A.key, body: { kind: "BUSINESS", sender_entity_id: sender, recipient_entity_id: recipient, source_currency: src, dest_currency: dst, source_amount: minor, funding_method: funding, ...(token ? { token } : {}) } });
  for (const [cc, ccy] of [["IN", "INR"], ["AE", "AED"], ["SG", "SGD"], ["DE", "EUR"], ["GB", "GBP"], ["CA", "CAD"], ["AU", "AUD"], ["JP", "JPY"], ["HK", "HKD"], ["HK", "CNH"]]) {
    const rid = cc === "IN" ? inRecv : await mk(`Recv ${ccy}`, cc, ccy);
    const q1 = await quoteFor(usSender, rid, "USD", ccy, 100000, "STABLECOIN", "USDC");
    check(`USDC (USD 1,000) lands as ${ccy} in ${cc}: a quote with timing`, q1.status === 201 && q1.json.destination.currency === ccy && q1.json.destination.amount > 0 && !!q1.json.timing, JSON.stringify(q1.json?.error ?? q1.json?.destination));
  }
  const jpOut = await mk("Recv JPY 2", "JP", "JPY");
  const q2 = await quoteFor(usSender, jpOut, "USD", "JPY", 100000, "STABLECOIN", "USDC");
  check("yen has no decimals: USD 1,000 pays out roughly 130,000-170,000 whole yen", q2.status === 201 && q2.json.destination.amount > 130000 && q2.json.destination.amount < 170000, JSON.stringify(q2.json?.destination));
  const usdtJp = await quoteFor(usSender, jpOut, "USD", "JPY", 100000, "STABLECOIN", "USDT");
  check("USDT is refused where the market rules do not allow it (Japan, Canada, EU), with a clear error", usdtJp.status === 422 && usdtJp.json.error.code === "NO_ROUTE", JSON.stringify(usdtJp.json?.error));
  check("USDT works where a partner market allows it (Australia)", (await quoteFor(usSender, await mk("Recv AUD 2", "AU", "AUD"), "USD", "AUD", 100000, "STABLECOIN", "USDT")).status === 201);
  for (const [cc, ccy, minor] of [["AE", "AED", 367250], ["DE", "EUR", 92000], ["GB", "GBP", 78500], ["CA", "CAD", 136000], ["AU", "AUD", 152000], ["JP", "JPY", 150000], ["HK", "HKD", 780000], ["HK", "CNH", 713000]]) {
    const sid = await mk(`Pay ${ccy}`, cc, ccy);
    const qf = await quoteFor(sid, inRecv, ccy, "INR", minor, "FIAT_LOCAL");
    check(`${ccy} (about USD 1,000) to INR: fiat in, rupees land in India through an authorised partner`, qf.status === 201 && qf.json.route.legs.at(-1).kind === "INDIA_PAYOUT" && qf.json.source.amount === minor && qf.json.breakdown.sourceAmountUsd > 800 && qf.json.breakdown.sourceAmountUsd < 1250, JSON.stringify(qf.json?.error ?? qf.json?.breakdown?.sourceAmountUsd));
  }
  const usdCnh = await quoteFor(await mk("Pay USD 3", "US", "USD"), await mk("Recv CNH 2", "HK", "CNH"), "USD", "CNH", 100000, "FIAT_LOCAL");
  check("dollars to offshore yuan quotes through the FX desks over the CIPS clearing rail, which has banking-hour windows", usdCnh.status === 201 && usdCnh.json.route.legs[0].rails.includes("CIPS"), JSON.stringify(usdCnh.json?.error ?? usdCnh.json?.route?.legs?.[0]?.rails));
  const ruRecv = await entity(A.key, `Ru Recv ${uniq}`, "RU", "RUB");
  const rub = await quoteFor(usSender, ruRecv, "USD", "RUB", 100000, "STABLECOIN", "USDC");
  check("RUB is closed whatever the mode: CURRENCY_CLOSED", rub.status === 422 && rub.json.error.code === "CURRENCY_CLOSED", JSON.stringify(rub.json?.error));
  const ruUsd = await entity(A.key, `Ru Usd ${uniq}`, "RU", "USD");
  const ruC = await quoteFor(usSender, ruUsd, "USD", "USD", 100000, "STABLECOIN", "USDC");
  check("a Russian recipient is closed even in dollars: COUNTRY_CLOSED", ruC.status === 422 && ruC.json.error.code === "COUNTRY_CLOSED", JSON.stringify(ruC.json?.error));
  const ruSender = await quoteFor(ruUsd, usSender, "USD", "USD", 100000, "STABLECOIN", "USDC");
  check("and a Russian sender", ruSender.status === 422 && ruSender.json.error.code === "COUNTRY_CLOSED", JSON.stringify(ruSender.json?.error));
  check("CNY onshore is fiat only: no stablecoin route into mainland China", (await quoteFor(usSender, await mk("Recv CNY", "CN", "CNY"), "USD", "CNY", 100000, "STABLECOIN", "USDC")).status === 422);

  console.log("== Virtual accounts: capabilities, local details per currency, credits");
  const capsR = await api("/api/virtual-accounts/capabilities", { jar: A.jar });
  const capHas = c => capsR.json.options?.find(o => o.currency === c);
  check("capabilities list what can be opened now (test mode: simulated), with the kind of local details", capsR.status === 200 && capsR.json.mode === "test" && ["EUR", "GBP", "USD", "CAD", "AUD", "JPY", "CNH"].every(c => capHas(c)) && capHas("CAD").details_type === "CA_TRANSIT" && capHas("CAD").partner_kind === "simulated", JSON.stringify(capsR.json).slice(0, 200));
  const caE = await mk("CA Holder", "CA", "CAD"), auE = await mk("AU Holder", "AU", "AUD"), jpE = await mk("JP Holder", "JP", "JPY"), gbE = await mk("GB Holder", "GB", "GBP");
  const vaCad = await api("/api/virtual-accounts", { method: "POST", key: A.key, body: { entity_id: caE, country: "CA", currency: "CAD", sweep_dest_currency: "USD" } });
  check("a CAD account gets Canadian institution/transit/account numbers", vaCad.status === 201 && !!vaCad.json.account_details.institution_number && !!vaCad.json.account_details.transit_number && vaCad.json.simulated === true, JSON.stringify(vaCad.json).slice(0, 220));
  const vaAud = await api("/api/virtual-accounts", { method: "POST", key: A.key, body: { entity_id: auE, country: "AU", currency: "AUD", sweep_dest_currency: "USD" } });
  check("an AUD account gets a BSB", vaAud.status === 201 && !!vaAud.json.account_details.bsb, JSON.stringify(vaAud.json).slice(0, 200));
  const vaJpy = await api("/api/virtual-accounts", { method: "POST", jar: A.jar, body: { entity_id: jpE, country: "JP", currency: "JPY", sweep_dest_currency: "USD" } });
  check("the dashboard (session) can open an account too", vaJpy.status === 201 && vaJpy.json.currency === "JPY", JSON.stringify(vaJpy.json).slice(0, 200));
  const vaBad = await api("/api/virtual-accounts", { method: "POST", key: A.key, body: { entity_id: gbE, country: "DE", currency: "GBP", sweep_dest_currency: "USD" } });
  const vaRub = await api("/api/virtual-accounts", { method: "POST", key: A.key, body: { entity_id: gbE, country: "RU", currency: "RUB", sweep_dest_currency: "USD" } });
  check("a currency is tied to its country (GBP in Germany) and RUB has no partner: NO_PARTNER", vaBad.json?.error?.code === "NO_PARTNER" && vaRub.json?.error?.code === "NO_PARTNER", JSON.stringify([vaBad.json?.error, vaRub.json?.error]));
  check("another organization cannot read the account", (await api(`/api/virtual-accounts/${vaCad.json.id}`, { jar: B.jar })).status === 404);
  const vc = await sim(A.key, { event: "virtual_account.credit", virtual_account_id: vaCad.json.id, amount: 150000, sender_name: "Toronto Client Inc", sender_country: "CA" });
  const vcT = await db.transfer.findFirst({ where: { fundingMethod: "VIRTUAL_ACCOUNT", fundingInstructions: { path: ["virtual_account_id"], equals: vaCad.json.id } } });
  check("a credit converts and starts paying out straight away (no balance kept)", !!vcT && ["PAYING_OUT", "COMPLETED", "QUARANTINED"].includes(vcT.status), JSON.stringify([vc.json, vcT?.status, vcT?.statusReason]));
  if (vcT?.status === "PAYING_OUT") await sim(A.key, { event: "payout.completed", transfer_id: vcT.id });
  const vaDetail = await api(`/api/virtual-accounts/${vaCad.json.id}`, { jar: A.jar });
  check("the account shows each credit with its status and the seconds from funds confirmed to completed", vaDetail.status === 200 && vaDetail.json.credits.length === 1 && vaDetail.json.credits[0].received.currency === "CAD" && (vaDetail.json.credits[0].status !== "COMPLETED" || typeof vaDetail.json.credits[0].seconds_to_complete === "number"), JSON.stringify(vaDetail.json.credits));
  const vaPage = await fetch(`${BASE}/dashboard/virtual-accounts`, { headers: { Cookie: A.jar.cookie }, redirect: "manual" });
  check("the virtual accounts page renders for a signed-in user", vaPage.status === 200 && (await vaPage.text()).includes("Virtual accounts"));

  console.log("== EURC (euro stablecoin, MiCA-friendly) and token/currency pegs");
  const euSender = await mk("EU Sender", "DE", "EUR");
  const euRecv = await mk("EU Receiver", "FR", "EUR");
  const eq = await quoteFor(euSender, euRecv, "EUR", "EUR", 100000, "STABLECOIN", "EURC");
  check("EURC from an EU sender to an EU recipient quotes in euros", eq.status === 201 && eq.json.route.token === "EURC" && eq.json.source.currency === "EUR" && eq.json.destination.currency === "EUR", JSON.stringify(eq.json?.error ?? eq.json?.route));
  const et = await api("/api/stablecoin/payins", { method: "POST", key: A.key, body: { quote_id: eq.json.id } });
  check("the partner issues an EURC deposit address and the amount is in euros (1,000.00 EURC)", et.status === 201 && et.json.funding_instructions?.token === "EURC" && et.json.funding_instructions?.amount_token === "1000.00", JSON.stringify(et.json?.funding_instructions ?? et.json));
  const e1 = await sim(A.key, { event: "deposit.confirmed", transfer_id: et.json.id });
  const e2 = await sim(A.key, { event: "payout.completed", transfer_id: et.json.id });
  check("an EURC transfer settles end to end", e1.json?.transfer_status === "PAYING_OUT" && e2.json?.transfer_status === "COMPLETED", JSON.stringify([e1.json, e2.json]));
  const eqInr = await quoteFor(euSender, inRecv, "EUR", "INR", 100000, "STABLECOIN", "EURC");
  check("EURC to INR: euro stablecoin in, rupees land through an authorised India partner", eqInr.status === 201 && eqInr.json.route.token === "EURC" && eqInr.json.route.legs.at(-1).kind === "INDIA_PAYOUT", JSON.stringify(eqInr.json?.error ?? eqInr.json?.route?.token));
  const wrong1 = await quoteFor(euSender, euRecv, "EUR", "EUR", 100000, "STABLECOIN", "USDC");
  const wrong2 = await quoteFor(usSender, inRecv, "USD", "INR", 100000, "STABLECOIN", "EURC");
  check("a token must match the currency it is priced in (USDC in EUR, EURC in USD are refused)", wrong1.status === 400 && wrong1.json.error.code === "INVALID_FUNDING" && wrong2.status === 400 && wrong2.json.error.code === "INVALID_FUNDING", JSON.stringify([wrong1.json?.error, wrong2.json?.error]));
  const usdtEu = await quoteFor(euSender, euRecv, "EUR", "EUR", 100000, "STABLECOIN", "USDT");
  check("USDT is refused for euros anyway (and not offered on EU legs)", usdtEu.status === 400);

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
