import { describe, expect, it } from "vitest";
import { rankRoutes, routeCostUsd, tierCostUsd } from "../lib/routing/engine";
import { buildBreakdown } from "../lib/pricing";
import { parseCatalog } from "../lib/routing/partners-config";
import type { FeeTier, Leg, Route } from "../lib/stablecoin/types";

const skydoLike: FeeTier[] = [{ upToUsd: 2_000, flatUsd: 19 }, { upToUsd: 10_000, flatUsd: 29 }, { upToUsd: null, bps: 30 }];
const rates = { USD: 1, INR: 83.4 };

describe("flat-fee tiers", () => {
  it("picks the tier by amount and adds flat plus percentage", () => {
    expect(tierCostUsd(skydoLike, 1_000)).toBe(19);
    expect(tierCostUsd(skydoLike, 2_000)).toBe(19); // the boundary belongs to the lower tier
    expect(tierCostUsd(skydoLike, 2_000.01)).toBe(29);
    expect(tierCostUsd(skydoLike, 10_000)).toBe(29);
    expect(tierCostUsd(skydoLike, 20_000)).toBeCloseTo(60, 6); // 0.3% of 20,000
    expect(tierCostUsd([{ upToUsd: 100, flatUsd: 2, bps: 50 }], 1_000)).toBe(7); // above every tier: the last one applies
    expect(tierCostUsd(undefined, 500)).toBe(0);
  });
  const leg = (id: string, over: Partial<Leg>): Leg => ({ id, partner: id, kind: "INDIA_PAYOUT", country: "IN", jurisdiction: "IN", destCurrency: "INR", acceptsFiat: ["USD"], rails: ["IMPS"], tokens: [], chains: [], spreadBps: 0, feeBps: 0, fixedFeeUsd: 0, etaSec: 3600, minUsd: 1, maxUsd: 29_000, kinds: ["BUSINESS"], indiaAuth: "PA_CB_E", ...over });
  const route = (l: Leg): Route => ({ id: l.id, legs: [l], token: null, chain: null, partners: [l.partner], spreadBps: l.spreadBps, feeBps: l.feeBps, fixedFeeUsd: l.fixedFeeUsd, etaSec: l.etaSec, minUsd: l.minUsd, maxUsd: l.maxUsd, usesStablecoin: false });
  const flat = route(leg("flat", { feeSchedule: skydoLike }));
  const pct = route(leg("pct", { feeBps: 100 })); // a 1% provider (plus tax, ignored here)

  it("is included in the route cost and in the quote breakdown, and the parts still add up", () => {
    expect(routeCostUsd(flat, 20_000)).toBeCloseTo(60, 4);
    const b = buildBreakdown({ route: flat, kind: "BUSINESS", sourceCurrency: "USD", destCurrency: "INR", sourceAmountMinor: 2_000_000, rates, markupBps: 20 });
    expect(b.partnerSpreadUsd + b.partnerFeeUsd + b.networkFeeUsd).toBeCloseTo(b.partnerCostUsd, 3);
    expect(b.partnerCostUsd).toBeCloseTo(60, 3);
    expect(b.totalCostUsd).toBeCloseTo(60 + 40, 3); // plus Vaulte's 20 bps
  });
  it("the ranking picks the percentage provider for small transfers and the flat-fee provider for large ones", () => {
    const pick = (amt: number) => rankRoutes([flat, pct], amt, "cheapest")[0].id;
    expect(pick(1_000)).toBe("pct");   // 1% = 10 beats a flat 19
    expect(pick(1_800)).toBe("pct");   // 18 beats 19
    expect(pick(2_000)).toBe("flat");  // 19 beats 20
    expect(pick(10_000)).toBe("flat"); // 29 beats 100
    expect(pick(25_000)).toBe("flat"); // 0.3% = 75 beats 250
  });
  it("a route with no schedule is priced exactly as before", () => {
    const l = leg("plain", { spreadBps: 12, feeBps: 10, fixedFeeUsd: 0.5 });
    expect(routeCostUsd(route(l), 5_000)).toBeCloseTo(5_000 * 0.0022 + 0.5, 6);
  });
  it("validates schedules in a live catalogue", () => {
    const leg = { id: "pcb.flat", partner: "razorpay", kind: "INDIA_PAYOUT", country: "IN", jurisdiction: "IN", destCurrency: "INR", acceptsFiat: ["USD"], rails: ["IMPS"], tokens: [], chains: [], spreadBps: 0, feeBps: 0, fixedFeeUsd: 0, etaSec: 3600, minUsd: 1, maxUsd: 29000, kinds: ["BUSINESS"], indiaAuth: "PA_CB_E", structure: { principal: "razorpay", fundsHeldBy: "PARTNER", accountHolder: "PARTNER_SAFEGUARDED", vaulteRole: "AGENT", agreementRef: "RZP-1" } };
    expect(parseCatalog(JSON.stringify([{ ...leg, feeSchedule: skydoLike }]))).toHaveLength(1);
    expect(() => parseCatalog(JSON.stringify([{ ...leg, feeSchedule: [{ upToUsd: 10_000, flatUsd: 29 }, { upToUsd: 2_000, flatUsd: 19 }] }]))).toThrow(/ascending/);
    expect(() => parseCatalog(JSON.stringify([{ ...leg, feeSchedule: [{ upToUsd: null, bps: 30 }, { upToUsd: 2_000, flatUsd: 19 }] }]))).toThrow(/open-ended/);
    expect(() => parseCatalog(JSON.stringify([{ ...leg, feeSchedule: [{ upToUsd: 2_000 }] }]))).toThrow(/flatUsd or bps/);
    expect(() => parseCatalog(JSON.stringify([{ ...leg, feeSchedule: [{ upToUsd: 2_000, flatUsd: 5000 }] }]))).toThrow();
  });
});
