// Read-only smoke test for Currencycloud / Wise with YOUR credentials. Moves no money (auth + rate quotes only).
//   CURRENCYCLOUD_LOGIN_ID=... CURRENCYCLOUD_API_KEY=... node scripts/partner-smoke.mjs currencycloud
//   WISE_CLIENT_ID=... WISE_CLIENT_SECRET=... node scripts/partner-smoke.mjs wise
// Use sandbox/demo credentials. Set *_ENV=live only for a deliberate live check.
const which = process.argv[2];
const j = async (url, init = {}) => { const r = await fetch(url, init); let b = null; try { b = await r.json(); } catch {} return { status: r.status, body: b }; };
const ok = (name, pass, extra = "") => { console.log(`${pass ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); if (!pass) process.exitCode = 1; };

if (which === "currencycloud") {
  const base = process.env.CURRENCYCLOUD_BASE_URL ?? (process.env.CURRENCYCLOUD_ENV === "live" ? "https://api.currencycloud.com" : "https://devapi.currencycloud.com");
  const a = await j(`${base}/v2/authenticate/api`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ login_id: process.env.CURRENCYCLOUD_LOGIN_ID ?? "", api_key: process.env.CURRENCYCLOUD_API_KEY ?? "" }) });
  ok("authenticate", a.status === 200 && !!a.body?.auth_token, `HTTP ${a.status}`);
  if (a.body?.auth_token) {
    const q = await j(`${base}/v2/rates/detailed?${new URLSearchParams({ sell_currency: "USD", buy_currency: "EUR", fixed_side: "sell", amount: "1000.00" })}`, { headers: { "X-Auth-Token": a.body.auth_token } });
    ok("rates/detailed USD->EUR", q.status === 200 && Number(q.body?.client_rate) > 0, JSON.stringify({ rate: q.body?.client_rate, buy: q.body?.client_buy_amount }));
    const f = await j(`${base}/v2/funding_accounts/find?currency=GBP`, { headers: { "X-Auth-Token": a.body.auth_token } });
    ok("funding_accounts/find GBP", f.status === 200, `${f.body?.funding_accounts?.length ?? 0} account(s)`);
  }
} else if (which === "wise") {
  const base = process.env.WISE_BASE_URL ?? (process.env.WISE_ENV === "live" ? "https://api.wise.com" : "https://api.wise-sandbox.com");
  const t = await j(`${base}/oauth/token`, { method: "POST", headers: { authorization: "Basic " + Buffer.from(`${process.env.WISE_CLIENT_ID}:${process.env.WISE_CLIENT_SECRET}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  ok("oauth token", t.status === 200 && !!t.body?.access_token, `HTTP ${t.status}`);
  if (t.body?.access_token) {
    const h = { authorization: `Bearer ${t.body.access_token}` };
    const p = await j(`${base}/v2/profiles`, { headers: h });
    const prof = (p.body ?? []).find(x => x.type === "business") ?? (p.body ?? [])[0];
    ok("profiles", p.status === 200 && !!prof, `HTTP ${p.status}`);
    if (prof) {
      const q = await j(`${base}/v3/profiles/${prof.id}/quotes`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ sourceCurrency: "USD", targetCurrency: "EUR", sourceAmount: 1000 }) });
      ok("quote USD->EUR", q.status === 200 && q.body?.rate > 0, JSON.stringify({ rate: q.body?.rate, options: q.body?.paymentOptions?.length }));
    }
  }
} else if (which === "circle") {
  // Circle Mint (USDC/EURC): ping is public; the business-account calls need your sandbox API key. Creates one deposit address (no money moves).
  const base = process.env.CIRCLE_BASE_URL ?? (process.env.CIRCLE_ENV === "live" ? "https://api.circle.com" : "https://api-sandbox.circle.com");
  const p = await j(`${base}/ping`);
  ok("ping", p.status === 200, JSON.stringify(p.body));
  const noKey = await j(`${base}/v1/businessAccount/balances`);
  ok("business paths exist and demand a key", noKey.status === 401, `HTTP ${noKey.status}`);
  if (process.env.CIRCLE_API_KEY) {
    const h = { authorization: `Bearer ${process.env.CIRCLE_API_KEY}`, "content-type": "application/json" };
    const b = await j(`${base}/v1/businessAccount/balances`, { headers: h });
    ok("balances", b.status === 200, `HTTP ${b.status}`);
    const a = await j(`${base}/v1/businessAccount/wallets/addresses/deposit`, { method: "POST", headers: h, body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), currency: "EUR", chain: "BASE" }) });
    ok("EURC deposit address on Base", a.status === 200 && !!a.body?.data?.address, `HTTP ${a.status} ${a.body?.message ?? ""}`);
  } else console.log("SKIP  authenticated checks (set CIRCLE_API_KEY to your sandbox key)");
} else { console.log("usage: node scripts/partner-smoke.mjs currencycloud|wise|circle"); process.exitCode = 2; }
