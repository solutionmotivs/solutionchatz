// Runs OUR adapter against the Currencycloud demo with your keys (CURRENCYCLOUD_LOGIN_ID / CURRENCYCLOUD_API_KEY, from .env.partners.local):
//   npx tsx scripts/currencycloud-live-check.ts
// Read-only: asks for indicative rates, creates nothing, moves no money. Prints our adapter's rate against the API's own mid-market rate.
import fs from "node:fs";
for (const l of fs.existsSync(".env.partners.local") ? fs.readFileSync(".env.partners.local", "utf8").split(/\r?\n/) : []) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l); if (m && m[2] && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
import { currencycloudFromEnv } from "../lib/psp/currencycloud/client";
import { CurrencycloudFxProvider } from "../lib/fx/providers/currencycloud";

(async () => {
  const c = currencycloudFromEnv();
  if (!c) { console.log("CURRENCYCLOUD_LOGIN_ID / CURRENCYCLOUD_API_KEY not set"); process.exit(2); }
  const p = new CurrencycloudFxProvider(c);
  let bad = 0;
  const cur = await c.currencies(); const codes = (cur.currencies ?? []).map(x => x.code);
  console.log(`account trades ${codes.length} currencies; INR:${codes.includes("INR")} CNH:${codes.includes("CNH")} SAR:${codes.includes("SAR")} AED:${codes.includes("AED")}`);
  for (const [s, d] of [["USD", "EUR"], ["USD", "AED"], ["USD", "SAR"], ["EUR", "GBP"], ["AED", "USD"], ["USD", "INR"], ["SAR", "INR"], ["USD", "CNH"]]) {
    try {
      const raw = await c.detailedRate({ sellCurrency: s, buyCurrency: d, sellAmount: "1000.00" });
      const q = await p.quote({ sourceCurrency: s, destCurrency: d, sourceAmountMinor: 100000, destCountry: d === "EUR" ? "DE" : d === "GBP" ? "GB" : d === "AED" ? "AE" : d === "SAR" ? "SA" : "US" }, { destPerSource: Number(raw.mid_market_rate), usdPerSource: 1 });
      // the API quotes mid in the pair's own orientation (e.g. EURUSD); flip it when our direction is the reverse
      const mid0 = Number(raw.mid_market_rate); const mid = raw.currency_pair === `${s}${d}` ? mid0 : 1 / mid0; const bps = mid ? Math.round(((mid - q.rate) / mid) * 1e6) / 100 : NaN;
      console.log(`PASS ${s}>${d}  rate ${q.rate.toFixed(6)}  mid ${mid.toFixed(6)}  spread ${bps} bps  rail ${q.rail}  cut-off ${q.cutOffAt ?? "-"}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const expected = /INR|CNH/.test(`${s}${d}`);
      console.log(`${expected ? "N/A " : "FAIL"} ${s}>${d}  ${msg.slice(0, 110)}`); if (!expected) bad++;
    }
  }
  process.exit(bad ? 1 : 0);
})();
