// Airwallex as an FX + payout provider. Prices come from their quotes API (a firm, lockable rate), never from a table.
import { airwallexFromEnv, type AirwallexClient } from "@/lib/psp/airwallex/client";
import { localRailFor, railEta } from "@/lib/routing/rails";
import type { FxProvider, FxQuote, FxQuoteRequest } from "./types";

/** Currencies Airwallex converts and pays out (subset; extend from your account's enabled corridors). */
const SUPPORTED = new Set(["USD", "EUR", "GBP", "AUD", "CAD", "HKD", "SGD", "JPY", "CHF", "CNH", "NZD", "AED", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "MXN", "BRL", "ZAR", "THB", "MYR", "IDR", "PHP", "KRW", "TRY"]);

const num = (v: unknown): number | null => { const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN; return Number.isFinite(n) && n > 0 ? n : null; };

export class AirwallexFxProvider implements FxProvider {
  readonly id = "airwallex";
  constructor(private client: AirwallexClient) {}

  supports(src: string, dst: string) { return src !== dst && SUPPORTED.has(src) && SUPPORTED.has(dst); }

  async quote(req: FxQuoteRequest): Promise<FxQuote> {
    const sellAmount = (req.sourceAmountMinor / 100).toFixed(2);
    const q = await this.client.createFxQuote({ sellCurrency: req.sourceCurrency, buyCurrency: req.destCurrency, sellAmount, validity: "MIN_15" });
    // Prefer the indicative amounts (buy/sell) over interpreting the pair orientation of client_rate.
    const buy = num(q.buy_amount), sell = num(q.sell_amount);
    let rate = buy && sell ? buy / sell : null;
    if (!rate) {
      const r = num(q.client_rate);
      const pair = q.currency_pair ?? "";
      if (r && pair.length === 6) rate = pair.slice(0, 3) === req.sourceCurrency ? r : 1 / r;
    }
    if (!rate) throw new Error("Airwallex quote had no usable rate");
    const rail = localRailFor(req.destCurrency, req.destCountry) ?? "SWIFT";
    // Fees come from your Airwallex contract. Defaults below are placeholders: set AIRWALLEX_SWIFT_FEE_USD / AIRWALLEX_LOCAL_FEE_USD.
    const fee = rail === "SWIFT" ? Number(process.env.AIRWALLEX_SWIFT_FEE_USD ?? 15) : Number(process.env.AIRWALLEX_LOCAL_FEE_USD ?? 0);
    return {
      provider: this.id, rate, quoteId: q.quote_id, validUntil: q.valid_to_at ? new Date(q.valid_to_at) : new Date(Date.now() + 14 * 60_000),
      fixedFeeUsd: fee, feeBps: 0, rail, etaSec: railEta(rail), minUsd: 10, maxUsd: 500_000, jurisdiction: "AU", country: "AU",
    };
  }
}

export function airwallexFxProvider(): AirwallexFxProvider | null {
  const c = airwallexFromEnv();
  return c ? new AirwallexFxProvider(c) : null;
}
