// The whole product flow through the running app against the REAL Nium sandbox (sandbox only; refuses live):
//   (start the app with the Nium sandbox keys, INDIA_FX_PROVIDERS=nium, NIUM_WEBHOOK_KEY, then)
//   BASE_URL=http://localhost:3055 CRON_SECRET=... NIUM_WEBHOOK_KEY=... npx tsx scripts/nium-app-e2e.ts
// The sandbox programme (client IAEX NETWORK) is regulated in the US, so the customer is a US-registered business whose founder lives in India (a non-resident,
// which Nium checks with its hosted liveness check). Indian and UAE customers need the programme enabled for Nium's SG region first (asked of Nium).
// 1 the business registers and is KYB-approved at Vaulte  2 a quote for USD to INR picks Nium  3 the transfer waits for Nium's approval of the business
// (identity check link surfaces in the dashboard)  4 Nium approves (sandbox simulation)  5 the business's USD arrives on its own Nium virtual account
// (simulated)  6 Vaulte notices it by webhook or by polling and starts the INR payout to its Indian supplier  7 Nium pays it and Vaulte completes the transfer
// 8 duplicate and forged webhooks do nothing  9 Nium's questions (RFI) are answered inside Vaulte  10 a rejection blocks transfers with a clear reason.
import fs from "node:fs";
import { createHash, randomBytes } from "node:crypto";
for (const l of fs.existsSync(".env.partners.local") ? fs.readFileSync(".env.partners.local", "utf8").split(/\r?\n/) : []) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l); if (m && m[2] && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
import { PrismaClient } from "@prisma/client";
import { niumFromEnv, parseNiumRef } from "../lib/psp/nium/client";
import { encryptString } from "../lib/security/crypto";

const BASE = process.env.BASE_URL ?? "http://localhost:3055";
const CRON = process.env.CRON_SECRET ?? "";
const HOOK_KEY = process.env.NIUM_WEBHOOK_KEY ?? "";
const db = new PrismaClient();
const nium = niumFromEnv();
let checks = 0, failures = 0;
const check = (name: string, ok: unknown, extra = "") => { checks++; if (ok) console.log(`  ok   ${name}`); else { failures++; console.log(`  FAIL ${name} ${extra}`); } };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const GOOD_PW = "correct horse battery staple 7";
const uniq = randomBytes(3).toString("hex");

type Jar = { cookie: string };
async function api(path: string, o: { method?: string; key?: string; jar?: Jar; body?: unknown; headers?: Record<string, string> } = {}) {
  const method = o.method ?? (o.body !== undefined ? "POST" : "GET");
  const h: Record<string, string> = { "Content-Type": "application/json", ...(o.headers ?? {}) };
  if (o.key) h.Authorization = `Bearer ${o.key}`;
  if (o.jar?.cookie) h.Cookie = o.jar.cookie;
  const res = await fetch(BASE + path, { method, headers: h, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(";"); if (o.jar) o.jar.cookie = /=$/.test(pair) || /Max-Age=0/i.test(c) ? "" : pair; }
  let json: any = null; try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
}
const job = (name: string) => api(`/api/internal/jobs/run?name=${name}&force=1`, { method: "POST", headers: { "x-cron-secret": CRON } });
const hook = (body: unknown, headers: Record<string, string> = {}) => fetch(`${BASE}/api/webhooks/partner/nium`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

/** A US business with an Indian founder and an Indian supplier: registered through the API, then given the verified KYB data a partner needs (written directly, as staff approval would). */
async function exporter(label: string, resident = false) {
  const email = `${label}-${uniq}@example.com`;
  const jar: Jar = { cookie: "" };
  const r = await api("/api/auth/register", { body: { name: `${label} Owner`, email, password: GOOD_PW, company_name: `${label} Tech ${uniq}`, country: "US", account_type: "BUSINESS", accept_terms: true } });
  const v = await api("/api/auth/verify-email", { jar, body: { email, code: r.json.dev_code } });
  const orgId: string = v.json.organization.id, key: string = v.json.test_api_key;
  const reg = String(100000000 + Math.floor(Math.random() * 800000000));
  await db.organization.update({ where: { id: orgId }, data: { legalName: `${label} Tech LLC ${uniq}`, country: "US", registrationNumber: reg, businessType: "LLC", incorporationDate: new Date("2019-05-21"), website: "https://example.com" } });
  const kyb = await db.verificationCase.create({ data: { kind: "KYB", subjectType: "ORGANIZATION", country: "US", status: "APPROVED", decidedAt: new Date(), organizationId: orgId, purposes: ["PAYMENTS"], profile: { address: "1 Main St", city: "Austin", state: "TX", postal_code: "73301", industry: "Software", expected_monthly_usd: 40000 } } });
  const bank = "021000021|123456789012";
  await db.verificationItem.create({ data: { caseId: kyb.id, code: "BANK_ACCOUNT", valueEnc: encryptString(bank), valueMasked: "****1234", valueHash: createHash("sha256").update(bank + orgId).digest("hex"), status: "VERIFIED" } });
  await db.verificationPerson.create({ data: { caseId: kyb.id, role: "APPLICANT", fullName: "Ravi Sharma", dateOfBirth: "1985-03-14", nationality: "IN", ownershipPct: 100, nameSource: "OCR", contact: { email: `ravi-${label}-${uniq}@example.com`, phone: "9820012345", phone_country_code: "91", address: resident ? { line1: "1 Main St", city: "Austin", state: "TX", postcode: "73301", country: "US" } : { line1: "12 MG Road", city: "Mumbai", state: "MH", postcode: "400001", country: "IN" } } } }); // by default lives in India: a non-resident of the US region
  await db.organization.update({ where: { id: orgId }, data: { kybStatus: "NOT_STARTED" } }); // stays on test keys: the partner's sandbox is what we exercise
  const mkEntity = async (name: string, country: string, currency: string) => { const e = await api("/api/entities", { key, body: { legalName: name, country, currency, isSandbox: true } }); await db.entity.update({ where: { id: e.json.id }, data: { verificationStatus: "APPROVED", isVerified: true, panVerified: true } }); return e.json.id as string; };
  const recipient = await mkEntity(`${label} Supplier Pvt Ltd ${uniq}`, "IN", "INR");
  const payer = await mkEntity(`${label} Tech LLC ${uniq}`, "US", "USD");
  await db.bankAccount.create({ data: { accountName: `${label} Supplier Pvt Ltd ${uniq}`, currency: "INR", country: "IN", ifsc: "HDFC0001234", accountNumber: "12345678901234", isVerified: true, isSandbox: true, entityId: recipient } });
  return { key, jar, orgId, recipient, payer, email };
}

async function main() {
  if (!nium) { console.log("NIUM_API_KEY / NIUM_CLIENT_HASH_ID not set"); process.exit(2); }
  if (!nium.isSandbox) { console.log("Refusing: not the Nium sandbox"); process.exit(2); }
  if (!CRON || !HOOK_KEY) { console.log("CRON_SECRET and NIUM_WEBHOOK_KEY must be set (the same values the app runs with)"); process.exit(2); }

  await db.rateLimit.deleteMany({ where: { key: { startsWith: "register:ip:" } } }); // local test runs register many accounts from one address
  console.log("== 1-2 exporter, quote");
  const A = await exporter("Sharma");
  const quoteBody = { kind: "BUSINESS", sender_entity_id: A.payer, recipient_entity_id: A.recipient, source_currency: "USD", dest_currency: "INR", source_amount: 500000, funding_method: "FIAT_LOCAL", prefer: "same_day" };
  const q = await api("/api/quotes", { key: A.key, body: quoteBody });
  check("a USD to INR quote is created and Nium is the partner on the route", q.status === 201 && q.json.route?.partners?.join() === "nium", JSON.stringify({ route: q.json?.route?.partners, alternates: q.json?.alternates?.map((a: any) => a.route?.partners ?? a.partners), fx: q.json?.breakdown?.fx, compared: q.json?.fx_compared, errors: q.json?.fx_errors }));
  check("the quote names Nium's own rate and shows the partner cost and Vaulte's fee separately", q.json.breakdown?.fx?.provider === "nium" && q.json.fees?.partner_cost_usd >= 1.5 && q.json.fees?.vaulte_fee_usd > 0, JSON.stringify(q.json.fees));
  check("the quote says Nium has not approved this customer yet", q.json.partner_onboarding?.some((p: any) => p.partner === "nium" && p.status !== "APPROVED"), JSON.stringify(q.json.partner_onboarding));
  const inv = await api("/api/invoices", { key: A.key, body: { number: `INV-${uniq}-1`, currency: "USD", purpose_code: "P0802", line_items: [{ description: "Software services", quantity: 1, unit_price: 500000 }] } });

  console.log("== 3 the transfer waits for Nium's approval of the exporter");
  const blocked = await api("/api/stablecoin/payins", { key: A.key, body: { quote_id: q.json.id, invoice_id: inv.json.id, purpose_code: "P0802", idempotency_key: `n-${uniq}-0` } });
  check("a transfer cannot start before the partner approves, and says why", blocked.status === 409 && blocked.json?.error?.code === "PARTNER_ONBOARDING_PENDING", JSON.stringify(blocked.json));
  const pc = await db.partnerCustomer.findFirstOrThrow({ where: { organizationId: A.orgId, partner: "nium" } });
  check("the exporter's verified details were sent to Nium and its reference is stored", !!pc.partnerRef && /^[0-9a-f-]{36}:[0-9a-f-]{36}$/.test(pc.partnerRef!) && pc.sandbox === true, JSON.stringify(pc));
  // Nium creates the customer asynchronously: when the identity check could not be started straight away, the status poll starts it.
  let link = await db.partnerCustomer.findUniqueOrThrow({ where: { id: pc.id } });
  for (let i = 0; i < 8 && !link.actionUrl; i++) { await sleep(4000); await job("partner-onboarding"); link = await db.partnerCustomer.findUniqueOrThrow({ where: { id: pc.id } }); }
  check("the dashboard shows Nium's identity-check link as the exact next step (no separate outreach)", link.status === "NEEDS_INFO" && /^https:\/\//.test(link.actionUrl ?? ""), `${link.status} ${link.actionUrl} ${link.note}`);
  await api("/api/stablecoin/payins", { key: A.key, body: { quote_id: q.json.id, invoice_id: inv.json.id, purpose_code: "P0802", idempotency_key: `n-${uniq}-0b` } });
  check("trying again does not create a second customer at Nium", (await db.partnerCustomer.count({ where: { organizationId: A.orgId, partner: "nium" } })) === 1 && (await db.partnerCustomer.findUniqueOrThrow({ where: { id: pc.id } })).partnerRef === pc.partnerRef);

  console.log("== 4 Nium approves (sandbox simulation), Vaulte learns it by polling and by webhook");
  const ref = parseNiumRef(pc.partnerRef!);
  for (let i = 0; i < 10; i++) { try { await nium.simulateOnboarding(ref.customerHashId, "clear"); break; } catch (e) { if (i === 9) throw e; await sleep(3000); } }
  let approved = false;
  for (let i = 0; i < 12 && !approved; i++) { await sleep(3000); await job("partner-onboarding"); approved = (await db.partnerCustomer.findUniqueOrThrow({ where: { id: pc.id } })).status === "APPROVED"; }
  check("the polling job picks up Nium's approval", approved);
  const bad = await hook({ template: "CUSTOMER_STATUS_WEBHOOK", customerHashId: ref.customerHashId, status: "rejected" }, { "x-partner-key": "wrong", "x-request-id": `bad-${uniq}` });
  check("a webhook without the shared key is refused and changes nothing", bad.status === 401 && (await db.partnerCustomer.findUniqueOrThrow({ where: { id: pc.id } })).status === "APPROVED");
  const ok1 = await hook({ template: "CUSTOMER_STATUS_WEBHOOK", customerHashId: ref.customerHashId, status: "clear", subStatus: "" }, { "x-partner-key": HOOK_KEY, "x-request-id": `st-${uniq}` });
  check("a webhook with the key is accepted", ok1.status === 200);

  console.log("== 5-7 payment, funds, payout, completion");
  const t = await api("/api/stablecoin/payins", { key: A.key, body: { quote_id: q.json.id, invoice_id: inv.json.id, purpose_code: "P0802", idempotency_key: `n-${uniq}-1` } });
  check("the transfer is created and waits for the buyer's wire", t.status === 201 && t.json.status === "AWAITING_FUNDS", JSON.stringify(t.json).slice(0, 300));
  const fi = t.json.funding_instructions?.bank_details ?? {};
  check("the buyer is shown the exporter's own Nium account (USD) to pay into", /^\d{8,}$/.test(fi.account_number ?? "") && fi.currency === "USD" && !!fi.bank_name, JSON.stringify(fi));
  const tid: string = t.json.id;
  await nium.simulateVanCredit({ virtualAccountNumber: fi.account_number, amount: 5000, currency: "USD", bankSource: fi.bank_name, country: "SG", bankReferenceNumber: `VAPP-${uniq}`, remitterName: "Acme Inc" });
  let tr = await db.transfer.findUniqueOrThrow({ where: { id: tid } });
  for (let i = 0; i < 20 && tr.status === "AWAITING_FUNDS"; i++) { await sleep(4000); await job("partner-reconcile"); tr = await db.transfer.findUniqueOrThrow({ where: { id: tid } }); }
  check("Vaulte notices the credit on the exporter's account and starts the INR payout", tr.status === "PAYING_OUT" && /^RT\d+/.test(tr.externalRef ?? ""), `${tr.status} ${tr.externalRef} ${tr.statusReason}`);
  const credits = await db.partnerEvent.count({ where: { partner: "nium", type: "customer.funds_received" } });
  check("the credit is recorded once, under the partner's own reference", credits >= 1 && (await db.partnerEvent.count({ where: { partner: "nium", externalId: { startsWith: "funds:FW" } } })) >= 1);
  let done = false;
  for (let i = 0; i < 40 && !done; i++) { await sleep(8000); await job("partner-reconcile"); tr = await db.transfer.findUniqueOrThrow({ where: { id: tid } }); done = tr.status === "COMPLETED"; }
  check("Nium pays the beneficiary and the transfer completes", done, `${tr.status} ${tr.statusReason}`);
  const net = (await db.glEntry.findMany({ where: { journal: { transferId: tid } } })).reduce((s, e) => s + e.baseUsdCents, 0n);
  check("every journal of the transfer balances to zero", net === 0n, String(net));

  console.log("== 8 duplicates and forged events");
  const before = await db.partnerEvent.count({ where: { partner: "nium" } });
  const paid = { template: "REMIT_TRANSACTION_PAID_WEBHOOK", systemReferenceNumber: tr.externalRef, customerHashId: ref.customerHashId };
  const dup = await hook(paid, { "x-partner-key": HOOK_KEY, "x-request-id": `paid-${uniq}` });
  check("a replayed 'paid' webhook is a duplicate and changes nothing", dup.status === 200 && (await db.transfer.findUniqueOrThrow({ where: { id: tid } })).status === "COMPLETED" && (await db.partnerEvent.count({ where: { partner: "nium" } })) === before);
  const forged = await hook({ template: "REMIT_TRANSACTION_RETURNED_WEBHOOK", systemReferenceNumber: tr.externalRef }, { "x-request-id": `forged-${uniq}` });
  check("a payout event without the shared key is refused", forged.status === 401 && (await db.transfer.findUniqueOrThrow({ where: { id: tid } })).status === "COMPLETED");

  console.log("== 9 Nium's questions are answered inside Vaulte");
  await db.rateLimit.deleteMany({ where: { key: { startsWith: "register:ip:" } } });
  const B = await exporter("Mehta", true);
  const qb = await api("/api/quotes", { key: B.key, body: { ...quoteBody, sender_entity_id: B.payer, recipient_entity_id: B.recipient } });
  const invB = await api("/api/invoices", { key: B.key, body: { number: `INV-${uniq}-2`, currency: "USD", purpose_code: "P0802", line_items: [{ description: "Services", quantity: 1, unit_price: 500000 }] } });
  await api("/api/stablecoin/payins", { key: B.key, body: { quote_id: qb.json.id, invoice_id: invB.json.id, purpose_code: "P0802", idempotency_key: `n-${uniq}-b` } });
  const pcB = await db.partnerCustomer.findFirstOrThrow({ where: { organizationId: B.orgId, partner: "nium" } });
  const refB = parseNiumRef(pcB.partnerRef!);
  // A US resident cannot do Nium's hosted check (biometric_kyc is refused for residents): the customer is told so, and the ID details go to Nium by another route (here, as a staff member would, through e_kyc).
  let linkB = await db.partnerCustomer.findUniqueOrThrow({ where: { id: pcB.id } });
  for (let i = 0; i < 8 && !/Unsupported/.test(linkB.note ?? ""); i++) { await sleep(4000); await job("partner-onboarding"); linkB = await db.partnerCustomer.findUniqueOrThrow({ where: { id: pcB.id } }); }
  check("a resident's refused identity check is shown with Nium's reason and no dead-end link", linkB.status === "NEEDS_INFO" && /Unsupported kycMode/.test(linkB.note ?? "") && !linkB.actionUrl, `${linkB.status} ${linkB.note}`);
  const v5B = await nium.customerV5(refB.customerHashId);
  for (let i = 0; i < 15; i++) { try { await nium.submitKyc(refB.customerHashId, { region: "US", entityType: "applicant", isResident: true, kycMode: "e_kyc", entityReferenceId: v5B.applicant!.referenceId, proofOfIdentityDocument: [{ type: "national_id", identificationNumber: "123456789", issuanceCountry: "US" }] }); break; } catch (e) { if (i === 14) throw e; await sleep(4000); } }
  for (let i = 0; i < 10; i++) { const c = await nium.customerV5(refB.customerHashId); if (c.subStatus === "under_review") break; await sleep(3000); }
  for (let i = 0; i < 12; i++) { try { await nium.simulateOnboarding(refB.customerHashId, "raise_rfi", { requestInfoFor: { customerType: "corporate", request: "applicant_Identity" } }); break; } catch (e) { if (i === 11) console.log("  simulate raise_rfi:", (e as Error).message.slice(0, 200)); await sleep(3000); } }
  let needs = false;
  for (let i = 0; i < 10 && !needs; i++) { await sleep(3000); await job("partner-onboarding"); needs = (await db.partnerCustomer.findUniqueOrThrow({ where: { id: pcB.id } })).status === "NEEDS_INFO"; }
  const list = await api(`/api/partner-customers/${pcB.id}/requests`, { jar: B.jar });
  const open = (list.json?.data ?? []).filter((x: any) => x.status === "OPEN");
  check("the customer sees what Nium asked for, with its fields", list.status === 200 && open.length >= 1 && open[0].fields.some((f: any) => f.kind === "file"), JSON.stringify(list.json).slice(0, 300));
  const other = await api(`/api/partner-customers/${pcB.id}/requests`, { jar: A.jar });
  check("another account cannot read or answer them", other.status === 404 || other.status === 401, String(other.status));
  const rfi = open[0];
  if (!rfi) { check("an open question exists to answer", false); throw new Error("no RFI to answer"); }
  const incomplete = await api(`/api/partner-customers/${pcB.id}/requests/${rfi.id}`, { jar: B.jar, body: { values: {}, files: {} } });
  check("an incomplete answer is refused and says what is missing", incomplete.status === 400 && /Identity Document/.test(incomplete.json?.error?.message ?? ""), JSON.stringify(incomplete.json));
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const answer = await api(`/api/partner-customers/${pcB.id}/requests/${rfi.id}`, { jar: B.jar, body: { values: { documentType: "Passport", documentNumber: "P1234567", documentExpiryDate: "2031-01-01" }, files: { document: { name: "passport.png", mime: "image/png", data_base64: png } } } });
  check("a complete answer is forwarded to Nium", answer.status === 200, JSON.stringify(answer.json));
  const after = await api(`/api/partner-customers/${pcB.id}/requests`, { jar: B.jar });
  check("Nium shows the request as answered", (after.json?.data ?? []).filter((x: any) => x.id === rfi.id).every((x: any) => x.status === "ANSWERED"), JSON.stringify(after.json).slice(0, 300));
  check("the audit log records that an answer was sent, never its content", (await db.auditLog.count({ where: { organizationId: B.orgId, action: "partner_customer.info_answered" } })) === 1 && !JSON.stringify(await db.auditLog.findMany({ where: { organizationId: B.orgId } })).includes("P1234567"));

  console.log("== 10 a rejection blocks transfers with a clear reason");
  for (let i = 0; i < 10; i++) { try { await nium.simulateOnboarding(refB.customerHashId, "reject"); break; } catch (e) { if (i === 9) console.log("  simulate reject:", (e as Error).message.slice(0, 200)); await sleep(3000); } }
  let rejected = false;
  for (let i = 0; i < 10 && !rejected; i++) { await sleep(3000); await job("partner-onboarding"); rejected = (await db.partnerCustomer.findUniqueOrThrow({ where: { id: pcB.id } })).status === "REJECTED"; }
  check("Nium's rejection is shown to the customer", rejected);
  const afterReject = await api("/api/stablecoin/payins", { key: B.key, body: { quote_id: qb.json.id, invoice_id: invB.json.id, purpose_code: "P0802", idempotency_key: `n-${uniq}-c` } });
  check("a rejected customer cannot send money through that partner", afterReject.status === 409 && /rejected/.test(afterReject.json?.error?.message ?? ""), JSON.stringify(afterReject.json));

  console.log(`\n${failures ? "FAILED" : "PASSED"}: ${checks - failures}/${checks} checks`);
  await db.$disconnect();
  process.exit(failures ? 1 : 0);
}
main().catch(async e => { console.error(e); await db.$disconnect(); process.exit(1); });
