// Which partner credentials are set, and (for the ones with a safe read-only probe) do they authenticate? Moves no money, creates nothing.
//   node scripts/partner-check.mjs            reads .env.partners.local and the environment
// A probe proves only that the keys work against the sandbox. It does not prove a corridor, a rate or a licence.
import fs from "node:fs";
const file = new URL("../.env.partners.local", import.meta.url);
if (fs.existsSync(file)) for (const l of fs.readFileSync(file, "utf8").split(/\r?\n/)) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l); if (m && m[2] && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
const E = process.env;
const j = async (url, init = {}) => { try { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) }); let b = null; try { b = await r.json(); } catch {} return { status: r.status, body: b }; } catch (e) { return { status: 0, body: String(e.message ?? e) }; } };
const basic = (u, p) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");

const P = [
  { name: "Airwallex", need: ["AIRWALLEX_CLIENT_ID", "AIRWALLEX_API_KEY"], probe: async () => { const r = await j((E.AIRWALLEX_BASE_URL ?? "https://api.sandbox.airwallex.com") + "/api/v1/authentication/login", { method: "POST", headers: { "x-client-id": E.AIRWALLEX_CLIENT_ID, "x-api-key": E.AIRWALLEX_API_KEY } }); return [r.status === 201 && !!r.body?.token, `login HTTP ${r.status}`]; } },
  { name: "Wise", need: ["WISE_CLIENT_ID", "WISE_CLIENT_SECRET"], probe: async () => { const r = await j((E.WISE_BASE_URL ?? "https://api.wise-sandbox.com") + "/oauth/token", { method: "POST", headers: { authorization: basic(E.WISE_CLIENT_ID, E.WISE_CLIENT_SECRET), "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" }); return [r.status === 200 && !!r.body?.access_token, `token HTTP ${r.status}`]; } },
  { name: "Currencycloud", need: ["CURRENCYCLOUD_LOGIN_ID", "CURRENCYCLOUD_API_KEY"], probe: async () => { const r = await j((E.CURRENCYCLOUD_BASE_URL ?? "https://devapi.currencycloud.com") + "/v2/authenticate/api", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ login_id: E.CURRENCYCLOUD_LOGIN_ID, api_key: E.CURRENCYCLOUD_API_KEY }) }); return [r.status === 200 && !!r.body?.auth_token, `authenticate HTTP ${r.status}`]; } },
  { name: "Circle Mint", need: ["CIRCLE_API_KEY"], probe: async () => { const r = await j((E.CIRCLE_BASE_URL ?? "https://api-sandbox.circle.com") + "/v1/businessAccount/balances", { headers: { authorization: `Bearer ${E.CIRCLE_API_KEY}` } }); return [r.status === 200, `balances HTTP ${r.status}`]; } },
  { name: "Bridge", need: ["BRIDGE_API_KEY"], probe: async () => { const r = await j((E.BRIDGE_BASE_URL ?? "https://api.sandbox.bridge.xyz") + "/v0/customers?limit=1", { headers: { "Api-Key": E.BRIDGE_API_KEY } }); return [r.status === 200, `customers HTTP ${r.status}`]; } },
  { name: "Razorpay (test)", need: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"], probe: async () => { const r = await j("https://api.razorpay.com/v1/payments?count=1", { headers: { authorization: basic(E.RAZORPAY_KEY_ID, E.RAZORPAY_KEY_SECRET) } }); return [r.status === 200, `payments HTTP ${r.status} (use rzp_test_ keys)`]; } },
  { name: "Cashfree (sandbox)", need: ["CASHFREE_CLIENT_ID", "CASHFREE_CLIENT_SECRET"], probe: async () => { const r = await j("https://sandbox.cashfree.com/pg/orders/vaulte_probe_0", { headers: { "x-client-id": E.CASHFREE_CLIENT_ID, "x-client-secret": E.CASHFREE_CLIENT_SECRET, "x-api-version": "2023-08-01" } }); return [[200, 404].includes(r.status), `order lookup HTTP ${r.status} (404 = keys accepted, no such order)`]; } },
  { name: "Modern Treasury", need: ["MODERN_TREASURY_ORG_ID", "MODERN_TREASURY_API_KEY"], probe: async () => { const r = await j("https://app.moderntreasury.com/api/ping", { headers: { authorization: basic(E.MODERN_TREASURY_ORG_ID, E.MODERN_TREASURY_API_KEY) } }); return [r.status === 200, `ping HTTP ${r.status}`]; } },
  { name: "BVNK", need: ["BVNK_HAWK_ID", "BVNK_HAWK_KEY"], note: "Hawk-signed requests: probe not written yet" },
  { name: "zerohash", need: ["ZEROHASH_API_KEY", "ZEROHASH_API_SECRET", "ZEROHASH_PASSPHRASE"], note: "HMAC-signed requests: probe not written yet" },
  { name: "PayU", need: ["PAYU_KEY", "PAYU_SALT"], note: "probe not written yet" },
  { name: "Juspay", need: ["JUSPAY_API_KEY", "JUSPAY_MERCHANT_ID"], note: "probe not written yet" },
  { name: "BillDesk", need: ["BILLDESK_MERCHANT_ID", "BILLDESK_CLIENT_ID", "BILLDESK_SECRET"], note: "probe not written yet" },
  { name: "Adyen India", need: ["ADYEN_API_KEY", "ADYEN_MERCHANT_ACCOUNT"], note: "probe not written yet" },
  { name: "ClearBank", need: ["CLEARBANK_CLIENT_ID", "CLEARBANK_CLIENT_SECRET"], note: "probe not written yet" },
  { name: "Banking Circle", need: ["BANKING_CIRCLE_CLIENT_ID", "BANKING_CIRCLE_CLIENT_SECRET"], note: "probe not written yet" },
  { name: "Modulr", need: ["MODULR_API_KEY", "MODULR_API_SECRET"], note: "probe not written yet" },
  { name: "Corpay", need: ["CORPAY_USERNAME", "CORPAY_PASSWORD", "CORPAY_CLIENT_CODE"], note: "probe not written yet" },
  { name: "Convera", need: ["CONVERA_CLIENT_ID", "CONVERA_CLIENT_SECRET"], note: "probe not written yet" },
  { name: "Nium", need: ["NIUM_CLIENT_HASH_ID", "NIUM_API_KEY"], note: "probe not written yet" },
];
let bad = 0;
for (const p of P) {
  const have = p.need.every(k => E[k]);
  if (!have) { console.log(`--    ${p.name.padEnd(20)} keys not set (${p.need.filter(k => !E[k]).join(", ")})`); continue; }
  if (!p.probe) { console.log(`SET   ${p.name.padEnd(20)} ${p.note}`); continue; }
  const [ok, msg] = await p.probe();
  console.log(`${ok ? "PASS" : "FAIL"}  ${p.name.padEnd(20)} ${msg}`); if (!ok) bad++;
}
process.exit(bad ? 1 : 0);
