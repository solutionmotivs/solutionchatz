// Live smoke test for the Airwallex adapter against YOUR sandbox (this repo's CI cannot reach Airwallex).
//   AIRWALLEX_CLIENT_ID=... AIRWALLEX_API_KEY=... node scripts/airwallex-smoke.mjs
// Optional: AIRWALLEX_BASE_URL (default sandbox), AIRWALLEX_ON_BEHALF_OF=acct_..., SMOKE_BENEFICIARY=1 (creates a test beneficiary; moves no money)
// Prints exactly what Airwallex returned for each call so field names can be confirmed or corrected.
import { randomUUID } from "node:crypto";
const base = process.env.AIRWALLEX_BASE_URL ?? "https://api.sandbox.airwallex.com";
const id = process.env.AIRWALLEX_CLIENT_ID, key = process.env.AIRWALLEX_API_KEY;
if (!id || !key) { console.error("Set AIRWALLEX_CLIENT_ID and AIRWALLEX_API_KEY (sandbox)"); process.exit(2); }
let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${cond ? "" : " " + extra}`); if (!cond) failures++; };
const show = (label, j) => console.log(`       ${label}:`, JSON.stringify(j).slice(0, 600));

const login = await fetch(`${base}/api/v1/authentication/login`, { method: "POST", headers: { "x-client-id": id, "x-api-key": key } });
const lj = await login.json().catch(() => ({}));
ok("login returns a bearer token", [200, 201].includes(login.status) && typeof lj.token === "string", JSON.stringify(lj).slice(0, 200));
if (!lj.token) process.exit(1);
show("login (expires_at)", { expires_at: lj.expires_at });
const H = { "Content-Type": "application/json", Authorization: `Bearer ${lj.token}`, ...(process.env.AIRWALLEX_ON_BEHALF_OF ? { "x-on-behalf-of": process.env.AIRWALLEX_ON_BEHALF_OF } : {}) };

const q = await fetch(`${base}/api/v1/fx/quotes/create`, { method: "POST", headers: H, body: JSON.stringify({ sell_currency: "USD", buy_currency: "EUR", sell_amount: "1000.00", validity: "MIN_15" }) });
const qj = await q.json().catch(() => ({}));
ok("FX quote create answers with a quote id", [200, 201].includes(q.status) && !!qj.quote_id, JSON.stringify(qj).slice(0, 300));
show("quote", qj);
const buy = Number(qj.buy_amount), sell = Number(qj.sell_amount);
ok("quote carries buy/sell amounts (the adapter derives the rate from them)", buy > 0 && sell > 0, "Adapter falls back to client_rate + currency_pair orientation");
console.log(`       effective rate: ${buy && sell ? (buy / sell).toFixed(6) : "n/a"} EUR per USD  | client_rate=${qj.client_rate} pair=${qj.currency_pair} valid_to_at=${qj.valid_to_at}`);

const conv = await fetch(`${base}/api/v1/fx/conversions/create`, { method: "POST", headers: H, body: JSON.stringify({ request_id: randomUUID(), sell_currency: "USD", buy_currency: "EUR", sell_amount: "1.00", reason: "smoke test" }) });
console.log(`       conversion endpoint /api/v1/fx/conversions/create -> HTTP ${conv.status} (if 404, set AIRWALLEX_CONVERSION_PATH=/api/v1/conversions/create; Vaulte's payout flow uses transfers with quote_id, not this endpoint)`);

if (process.env.SMOKE_BENEFICIARY === "1") {
  const b = await fetch(`${base}/api/v1/beneficiaries/create`, { method: "POST", headers: H, body: JSON.stringify({
    request_id: randomUUID(), nickname: "vaulte-smoke",
    beneficiary: { type: "BANK_ACCOUNT", entity_type: "COMPANY", company_name: "Vaulte Smoke GmbH", bank_details: { account_name: "Vaulte Smoke GmbH", account_currency: "EUR", bank_country_code: "DE", iban: "DE89370400440532013000" }, address: { street_address: "1 Test Str", city: "Berlin", postcode: "10115", country_code: "DE" } },
    transfer_methods: ["LOCAL"],
  }) });
  const bj = await b.json().catch(() => ({}));
  ok("beneficiary create returns an id (field `id`)", [200, 201].includes(b.status) && !!(bj.id ?? bj.beneficiary_id), JSON.stringify(bj).slice(0, 400));
  show("beneficiary", bj);
}
console.log(failures ? `\n${failures} check(s) failed. Send me the output above and I will correct the adapter.` : "\nAll smoke checks passed.");
process.exit(failures ? 1 : 0);
