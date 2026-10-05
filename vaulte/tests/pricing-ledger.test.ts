import { describe, expect, it } from "vitest";
import { buildBreakdown, markupBpsFor, validateMargin, MIN_MARGIN_BPS } from "@/lib/pricing";
import { findRoutes, rankRoutes } from "@/lib/routing/engine";
import { amountsFromBreakdown, assertBalanced, feesJournal, fundsReceivedJournal, payoutJournals, LedgerError } from "@/lib/ledger";

const rates = { USD: 1, EUR: 0.92, INR: 83.42, AED: 3.6725, GBP: 0.785, SGD: 1.348 };

describe("pricing", () => {
  it("lowers markup with volume and never goes below the floor", () => {
    expect(markupBpsFor("BUSINESS", 5_000)).toBeGreaterThan(markupBpsFor("BUSINESS", 500_000));
    expect(markupBpsFor("BUSINESS", 50_000_000)).toBeGreaterThanOrEqual(MIN_MARGIN_BPS);
    expect(markupBpsFor("PERSONAL", 100)).toBeGreaterThan(markupBpsFor("PERSONAL", 2_000));
  });

  it("splits landed cost and sums correctly", () => {
    const route = rankRoutes(findRoutes({
      kind: "BUSINESS", originCountry: "US", destCountry: "IN", sourceCurrency: "USD", destCurrency: "INR",
      amountUsd: 10_000, fundingMethod: "FIAT_LOCAL",
    }), 10_000, "cheapest")[0];
    const b = buildBreakdown({ route, kind: "BUSINESS", sourceCurrency: "USD", destCurrency: "INR", sourceAmountMinor: 1_000_000, rates });
    expect(b.sourceAmountUsd).toBeCloseTo(10_000, 2);
    expect(b.totalCostUsd).toBeCloseTo(b.partnerCostUsd + b.markupUsd, 3);
    expect(b.destAmountUsd).toBeCloseTo(b.sourceAmountUsd - b.totalCostUsd, 3);
    expect(b.totalCostBps).toBeLessThan(300);
    expect(b.savingsVsBankUsd).toBeGreaterThan(0);
    expect(validateMargin(b).ok).toBe(true);
  });

  it("clamps a too-low requested markup to the floor and rejects dust amounts", () => {
    const route = rankRoutes(findRoutes({
      kind: "PERSONAL", originCountry: "US", destCountry: "IN", sourceCurrency: "USD", destCurrency: "INR",
      amountUsd: 20, fundingMethod: "FIAT_LOCAL",
    }), 20, "cheapest")[0];
    const b = buildBreakdown({ route, kind: "PERSONAL", sourceCurrency: "USD", destCurrency: "INR", sourceAmountMinor: 2_000, rates, markupBps: 1 });
    expect(b.markupBps).toBe(MIN_MARGIN_BPS);
    expect(validateMargin({ ...b, destAmountUsd: -1 }).ok).toBe(false);
  });
});

describe("memo ledger", () => {
  it("rejects unbalanced journals", () => {
    expect(() => assertBalanced([{ account: "PARTNER_HELD", amountUsd: 100n }, { account: "CUSTOMER_LIABILITY", amountUsd: -99n }])).toThrow(LedgerError);
  });

  it("a completed transfer nets customer liability to zero and leaves markup owed", () => {
    const a = amountsFromBreakdown(1000, 3.5, 3);
    const lines = [fundsReceivedJournal(a), feesJournal(a), ...payoutJournals(a)];
    lines.forEach(assertBalanced);
    const bal: Record<string, bigint> = {};
    for (const j of lines) for (const l of j) bal[l.account] = (bal[l.account] ?? 0n) + l.amountUsd;
    expect(bal.CUSTOMER_LIABILITY).toBe(0n);
    expect(bal.PARTNER_COST_PAYABLE).toBe(0n);
    expect(bal.REV_MARKUP).toBe(-a.markupUsdCents);
    expect(bal.PARTNER_HELD).toBe(a.markupUsdCents); // only Vaulte's own markup remains at the partner
  });
});
