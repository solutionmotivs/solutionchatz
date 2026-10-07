// An FX provider can convert currency A to currency B and pay it out. Quotes are firm for a short time.
export interface FxQuoteRequest {
  sourceCurrency: string;
  destCurrency: string;
  /** Source amount in minor units. */
  sourceAmountMinor: number;
  destCountry: string;
}

export interface FxQuote {
  provider: string;
  /** Units of destination currency per 1 unit of source currency, as the provider will apply it. */
  rate: number;
  /** Provider's own quote id (used to lock the rate when converting). */
  quoteId?: string;
  validUntil: Date;
  /** Fixed fee charged on top, in USD. */
  fixedFeeUsd: number;
  /** Percentage fee on top, in basis points (separate from the embedded FX spread). */
  feeBps: number;
  rail: string;
  etaSec: number;
  minUsd: number;
  maxUsd: number;
  jurisdiction: string;
  country: string;
  /** Provider's next trade cut-off for this pair (ISO time), when it publishes one. Trades after it settle later. */
  cutOffAt?: string;
}

export interface FxProvider {
  readonly id: string;
  supports(sourceCurrency: string, destCurrency: string): boolean;
  quote(req: FxQuoteRequest, mid: { destPerSource: number; usdPerSource: number }): Promise<FxQuote>;
}
