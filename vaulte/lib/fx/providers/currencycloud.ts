import { majorString } from "@/lib/currency";
import { currencycloudFromEnv, type CurrencycloudClient } from "@/lib/psp/currencycloud/client";
import { localRailFor, railEta } from "@/lib/routing/rails";
import type { FxProvider, FxQuote, FxQuoteRequest } from "./types";

const SUPPORTED = new Set(["USD", "EUR", "GBP", "AUD", "CAD", "CHF", "CNH", "CZK", "DKK", "HKD", "HUF", "ILS", "JPY", "MXN", "NOK", "NZD", "PLN", "SEK", "SGD", "THB", "TRY", "ZAR", "AED", "SAR", "BGN", "RON", "QAR", "KES"]);

export class CurrencycloudFxProvider implements FxProvider {
  readonly id = "currencycloud";
  constructor(private client: CurrencycloudClient) {}
  supports(s: string, d: string) { return s !== d && SUPPORTED.has(s) && SUPPORTED.has(d); }
  async quote(req: FxQuoteRequest, _mid?: unknown): Promise<FxQuote> {
    const r = await this.client.detailedRate({ sellCurrency: req.sourceCurrency, buyCurrency: req.destCurrency, sellAmount: majorString(req.sourceAmountMinor, req.sourceCurrency) });
    const buy = Number(r.client_buy_amount), sell = Number(r.client_sell_amount);
    const rate = buy > 0 && sell > 0 ? buy / sell : null;
    if (!rate) throw new Error("Currencycloud quote had no usable amounts");
    const rail = localRailFor(req.destCurrency, req.destCountry) ?? "SWIFT";
    const fee = rail === "SWIFT" ? Number(process.env.CURRENCYCLOUD_SWIFT_FEE_USD ?? 10) : Number(process.env.CURRENCYCLOUD_LOCAL_FEE_USD ?? 0);
    // The rate is indicative (not lockable): quote validity is short and the payout fixes the buy side.
    return { provider: this.id, rate, validUntil: new Date(Date.now() + 5 * 60_000 + 60_000), fixedFeeUsd: fee, feeBps: 0, rail, etaSec: railEta(rail), minUsd: 10, maxUsd: 1_000_000, jurisdiction: "UK", country: "GB" };
  }
}

export function currencycloudFxProvider(): CurrencycloudFxProvider | null {
  const c = currencycloudFromEnv();
  return c ? new CurrencycloudFxProvider(c) : null;
}
