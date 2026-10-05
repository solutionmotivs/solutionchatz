// Competing mock FX desks for sandbox/tests. Spreads differ so the aggregator has something real to choose between.
import { localRailFor, railEta } from "@/lib/routing/rails";
import type { FxProvider, FxQuote, FxQuoteRequest } from "./types";

const MAJORS = new Set(["USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD", "HKD", "JPY", "CHF"]);

export class MockFxDesk implements FxProvider {
  constructor(readonly id: string, private spreadBps: number, private feeUsd: number, private jurisdiction = "UK") {}
  supports(src: string, dst: string) { return src !== dst && MAJORS.has(src) && MAJORS.has(dst); }
  async quote(req: FxQuoteRequest, mid: { destPerSource: number }): Promise<FxQuote> {
    const rail = localRailFor(req.destCurrency, req.destCountry) ?? "SWIFT";
    return {
      provider: this.id, rate: mid.destPerSource * (1 - this.spreadBps / 10_000), quoteId: `${this.id}_${Date.now()}`,
      validUntil: new Date(Date.now() + 15 * 60_000), fixedFeeUsd: this.feeUsd, feeBps: 0, rail, etaSec: railEta(rail),
      minUsd: 10, maxUsd: 1_000_000, jurisdiction: this.jurisdiction, country: this.jurisdiction === "UK" ? "GB" : "US",
    };
  }
}
