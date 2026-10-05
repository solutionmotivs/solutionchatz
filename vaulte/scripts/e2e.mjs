// End-to-end check against a running server and database (sandbox, mock partners).
// Usage: BASE_URL=http://localhost:3055 ADMIN_API_TOKEN=... MOCK_PARTNER_WEBHOOK_SECRET=... DATABASE_URL=... node scripts/e2e.mjs
import { createHmac } from "node:crypto";
import http from "node:http";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN = process.env.ADMIN_API_TOKEN;
const MOCK_SECRET = process.env.MOCK_PARTNER_WEBHOOK_SECRET ?? "dev-mock-partner-secret";
const db = new PrismaClient();
let failures = 0;
let checks = 0;

function check(name, cond, extra = "") {
  checks++;
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name} ${extra}`); }
}

async function api(path, { method = "GET", key, body, admin, headers = {} } = {}) {
  const h = { "Content-Type": "application/json", ...headers };
  if (key) h.Authorization = `Bearer ${key}`;
  if (admin) h["x-admin-token"] = ADMIN;
  const res = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const uniq = Math.random().toString(36).slice(2, 8);
async function register(name, country) {
  const r = await api("/api/auth/register", { method: "POST", body: { name, email: `${name.toLowerCase()}-${uniq}@example.com`, password: "testpass123", company_name: `${name} Co ${uniq}`, country } });
  return { key: r.json.test_api_key, orgId: r.json.organization.id };
}
async function entity(key, legalName, country, currency, entityType = "BUSINESS") {
  const r = await api("/api/entities", { method: "POST", key, body: { legalName, country, currency, isSandbox: true } });
  const id = r.json.id;
  await db.entity.update({ where: { id }, data: { entityType } });
  return id;
}
async function verify(id, extra = {}) {
  return api("/api/admin/entities/verify", { method: "POST", admin: true, body: { entity_id: id, decision: "APPROVED", ...extra } });
}
const sim = (key, body) => api("/api/sandbox/partner/simulate", { method: "POST", key, body });
async function balances(transferId) {
  const entries = await db.ledgerEntry.findMany({ where: { journal: { transferId } } });
  const out = {};
  for (const e of entries) out[e.account] = (out[e.account] ?? 0n) + e.amountUsd;
  return out;
}

async function main() {
  console.log("== Foundation");
  check("admin route rejects missing token", (await api("/api/admin/kyb/approve", { method: "POST", body: {} })).status === 401);
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
  const rej = await api(`/api/admin/transfers/${tU.json.id}/review`, { method: "POST", admin: true, body: { decision: "REJECT", note: "refund sender" } });
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
