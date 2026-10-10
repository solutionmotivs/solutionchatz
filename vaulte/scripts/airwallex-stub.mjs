// Local stand-in for the Airwallex API, for development and the e2e suite. NOT Airwallex: it only mimics the calls Vaulte makes.
//   AIRWALLEX_STUB_PORT=39911 node scripts/airwallex-stub.mjs
// Then run Vaulte with AIRWALLEX_BASE_URL=http://127.0.0.1:39911 AIRWALLEX_CLIENT_ID=stub AIRWALLEX_API_KEY=stub AIRWALLEX_WEBHOOK_SECRET=stubsecret
import http from "node:http";
const port = Number(process.env.AIRWALLEX_STUB_PORT ?? 39911);
const MID = { USD: 1, EUR: 0.9211, GBP: 0.7853, AUD: 1.5231, CAD: 1.3612, SGD: 1.348, AED: 3.6725, CHF: 0.8841, JPY: 149.5 };
const SPREAD = Number(process.env.STUB_SPREAD_BPS ?? 3) / 10_000;
const state = { logins: 0, quotes: [], beneficiaries: [], transfers: [], globalAccounts: [] };
http.createServer((req, res) => {
  let raw = ""; req.on("data", c => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    const send = (code, json) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(json)); };
    if (req.url === "/_stub/state") return send(200, state);
    if (req.url === "/api/v1/authentication/login") { state.logins++; return send(201, { token: "stub-token", expires_at: new Date(Date.now() + 30 * 60_000).toISOString() }); }
    if (req.headers.authorization !== "Bearer stub-token") return send(401, { code: "unauthorized" });
    if (req.url === "/api/v1/fx/quotes/create") {
      const rate = (MID[body.buy_currency] / MID[body.sell_currency]) * (1 - SPREAD);
      const q = { quote_id: `stubq-${state.quotes.length + 1}`, sell_currency: body.sell_currency, buy_currency: body.buy_currency, sell_amount: body.sell_amount, buy_amount: (Number(body.sell_amount) * rate).toFixed(2), client_rate: rate, currency_pair: body.sell_currency + body.buy_currency, valid_to_at: new Date(Date.now() + 15 * 60_000).toISOString() };
      state.quotes.push(q); return send(201, q);
    }
    if (req.url === "/api/v1/beneficiaries/create") { const id = `stubben-${state.beneficiaries.length + 1}`; state.beneficiaries.push({ id, ...body }); return send(201, { id }); }
    if (req.url === "/api/v1/transfers/create") {
      const dup = state.transfers.find(t => t.request_id === body.request_id); if (dup) return send(201, { id: dup.id, status: "SCHEDULED" });
      const id = `stubtr-${state.transfers.length + 1}`; state.transfers.push({ id, ...body }); return send(201, { id, status: "SCHEDULED" });
    }
    if (req.url === "/api/v1/global_accounts/create") { const id = `stubga-${state.globalAccounts.length + 1}`; state.globalAccounts.push({ id, ...body }); return send(201, { id, account_name: "VAULTE STUB CUSTOMER", iban: "GB29NWBK60161331926819", institution: { name: "Stub Bank" } }); }
    send(404, { code: "not_found", message: req.url });
  });
}).listen(port, "127.0.0.1", () => console.log(`airwallex stub on ${port}`));
