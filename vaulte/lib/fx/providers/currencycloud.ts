import { majorString } from "@/lib/currency";
import { currencycloudFromEnv, type CurrencycloudClient } from "@/lib/psp/currencycloud/client";
import { localRailFor, railEta } from "@/lib/routing/rails";
import type { FxProvider, FxQuote, FxQuoteRequest } from "./types";

const SUPPORTED = new Set(["USD", "EUR", "GBP", "AUD", "CAD", "CHF", "CNH", "CZK", "DKK", "HKD", "HUF", "ILS", "JPY", "MXN", "NOK", "NZD", "PLN", "SEK", "SGD", "THB", "TRY", "ZAR", "AED", "SAR", "BGN", "RON", "QAR", "KES"]);

export class CurrencycloudFxProvider implements FxProvider {
  readonly id = "currencycloud";
  constructor(private client: CurrencycloudClient) {}
  /** What this account can actually trade, learned from the API on first use (the static list is only a first guess). */
  private known: Set<string> | null = null; private knownAt = 0;
  supports(s: string, d: string) { const set = this.known ?? SUPPORTED; return s !== d && set.has(s) && set.has(d); }
  private async refresh() {
    if (this.known && Date.now() - this.knownAt < 3600_000) return;
    try { const r = await this.client.currencies(); const codes = (r.currencies ?? []).map(c => c.code); if (codes.length) { this.known = new Set(codes.filter(c => c !== "INR")); this.knownAt = Date.now(); } } catch { /* keep the static list */ }
  }
  async quote(req: FxQuoteRequest, _mid?: unknown): Promise<FxQuote> {
    await this.refresh();
    if (!this.supports(req.sourceCurrency, req.destCurrency)) throw new Error(`Currencycloud cannot trade ${req.sourceCurrency}/${req.destCurrency} on this account`);
    const r = await this.client.detailedRate({ sellCurrency: req.sourceCurrency, buyCurrency: req.destCurrency, sellAmount: majorString(req.sourceAmountMinor, req.sourceCurrency) });
    const buy = Number(r.client_buy_amount), sell = Number(r.client_sell_amount);
    const rate = buy > 0 && sell > 0 ? buy / sell : null;
    if (!rate) throw new Error("Currencycloud quote had no usable amounts");
    const rail = localRailFor(req.destCurrency, req.destCountry) ?? "SWIFT";
    const fee = rail === "SWIFT" ? Number(process.env.CURRENCYCLOUD_SWIFT_FEE_USD ?? 10) : Number(process.env.CURRENCYCLOUD_LOCAL_FEE_USD ?? 0);
    // The rate is indicative (not lockable): quote validity is short and the payout fixes the buy side.
    return { provider: this.id, rate, validUntil: new Date(Date.now() + 5 * 60_000 + 60_000), fixedFeeUsd: fee, feeBps: 0, rail, etaSec: railEta(rail), minUsd: 10, maxUsd: 1_000_000, jurisdiction: "UK", country: "GB", cutOffAt: r.settlement_cut_off_time };
  }
}

export function currencycloudFxProvider(): CurrencycloudFxProvider | null {
  const c = currencycloudFromEnv();
  return c ? new CurrencycloudFxProvider(c) : null;
}
