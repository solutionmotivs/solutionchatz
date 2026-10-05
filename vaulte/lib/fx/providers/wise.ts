import { wiseFromEnv, type WiseClient } from "@/lib/psp/wise/client";
import { localRailFor, railEta } from "@/lib/routing/rails";
import type { FxProvider, FxQuote, FxQuoteRequest } from "./types";

const SUPPORTED = new Set(["USD", "EUR", "GBP", "AUD", "CAD", "CHF", "CZK", "DKK", "HKD", "HUF", "JPY", "MYR", "MXN", "NOK", "NZD", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "AED", "BRL", "ZAR", "KES", "UGX", "IDR", "PHP", "VND", "BDT", "LKR", "NPR", "PKR", "CNY", "ILS"]);

export class WiseFxProvider implements FxProvider {
  readonly id = "wise";
  constructor(private client: WiseClient) {}
  supports(s: string, d: string) { return s !== d && SUPPORTED.has(s) && SUPPORTED.has(d); }
  async quote(req: FxQuoteRequest, _mid?: unknown): Promise<FxQuote> {
    const q = await this.client.createQuote({ sourceCurrency: req.sourceCurrency, targetCurrency: req.destCurrency, sourceAmount: Number((req.sourceAmountMinor / 100).toFixed(2)) });
    const opts = (q.paymentOptions ?? []).filter(o => !o.disabled && o.payIn === "BALANCE");
    const o = opts.sort((a, b) => (b.targetAmount ?? 0) - (a.targetAmount ?? 0))[0];
    // Rate net of Wise's fee, so the comparison with other providers is on what the recipient actually receives.
    const net = o?.targetAmount ?? q.targetAmount, src = o?.sourceAmount ?? q.sourceAmount;
    const rate = net > 0 && src > 0 ? net / src : q.rate;
    if (!(rate > 0)) throw new Error("Wise quote had no usable rate");
    const rail = localRailFor(req.destCurrency, req.destCountry) ?? "SWIFT";
    return { provider: this.id, rate, quoteId: q.id, validUntil: q.expirationTime ? new Date(q.expirationTime) : new Date(Date.now() + 25 * 60_000), fixedFeeUsd: 0, feeBps: 0, rail, etaSec: railEta(rail), minUsd: 1, maxUsd: 1_000_000, jurisdiction: "GB", country: "GB" };
  }
}

export function wiseFxProvider(): WiseFxProvider | null {
  const c = wiseFromEnv();
  return c ? new WiseFxProvider(c) : null;
}
