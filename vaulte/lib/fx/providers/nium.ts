import { majorString } from "@/lib/currency";
import { niumFromEnv, type NiumClient } from "@/lib/psp/nium/client";
import { localRailFor, railEta } from "@/lib/routing/rails";
import type { FxProvider, FxQuote, FxQuoteRequest } from "./types";

/** Currencies Nium lists for payouts. The account's own enablement decides what really works; a failed quote simply drops Nium from that comparison. */
const SUPPORTED = new Set(["USD", "EUR", "GBP", "SGD", "AUD", "NZD", "CAD", "HKD", "JPY", "CNY", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON", "BGN", "TRY", "ZAR", "AED", "SAR", "QAR", "KWD", "BHD", "OMR", "ILS", "INR", "PKR", "BDT", "LKR", "NPR", "IDR", "MYR", "PHP", "THB", "VND", "KRW", "TWD", "MXN", "BRL", "KES", "NGN", "EGP"]);

export class NiumFxProvider implements FxProvider {
  readonly id = "nium";
  constructor(private client: NiumClient) {}
  supports(s: string, d: string) { return s !== d && SUPPORTED.has(s) && SUPPORTED.has(d); }
  async quote(req: FxQuoteRequest, _mid?: unknown): Promise<FxQuote> {
    if (!this.supports(req.sourceCurrency, req.destCurrency)) throw new Error(`Nium does not list ${req.sourceCurrency}/${req.destCurrency}`);
    const r = await this.client.exchangeRate({ sourceCurrencyCode: req.sourceCurrency, destinationCurrencyCode: req.destCurrency, sourceAmount: Number(majorString(req.sourceAmountMinor, req.sourceCurrency)) });
    const rate = Number(r.exchangeRate);
    if (!(rate > 0)) throw new Error("Nium returned no usable rate");
    // India is paid on IMPS (UPI where the amount and the recipient allow it: the India rail picker decides at payout time).
    const rail = req.destCurrency === "INR" ? "IMPS" : localRailFor(req.destCurrency, req.destCountry) ?? "SWIFT";
    const fee = rail === "SWIFT" ? Number(process.env.NIUM_SWIFT_FEE_USD ?? 5) : Number(process.env.NIUM_LOCAL_FEE_USD ?? 0);
    // The v2 rate is indicative and carries Nium's markup for this client (zero on a plain account); the payout fixes the final rate.
    const validUntil = r.expiryDate ? new Date(r.expiryDate.replace(" ", "T") + "Z") : new Date(Date.now() + 5 * 60_000);
    return { provider: this.id, rate, quoteId: r.quoteId, validUntil: validUntil.getTime() > Date.now() ? validUntil : new Date(Date.now() + 60_000), fixedFeeUsd: fee, feeBps: Number(process.env.NIUM_FEE_BPS ?? 0), rail, etaSec: railEta(rail), minUsd: 10, maxUsd: 1_000_000, jurisdiction: "US", country: "US" };
  }
}

export function niumFxProvider(): NiumFxProvider | null {
  const c = niumFromEnv();
  return c ? new NiumFxProvider(c) : null;
}
