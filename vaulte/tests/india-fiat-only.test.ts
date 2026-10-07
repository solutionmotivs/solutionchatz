import { describe, expect, it } from "vitest";
import { assertIndiaFiatOnly, parseCatalog } from "../lib/routing/partners-config";
import { MOCK_LEGS } from "../lib/routing/catalog";
import { findRoutes } from "../lib/routing/engine";

const leg = (o: Record<string, unknown>) => ({ id: "x.y.z", partner: "airwallex", kind: "INDIA_PAYOUT", country: "IN", jurisdiction: "IN", destCurrency: "INR", acceptsFiat: ["USD"], rails: ["IMPS"], tokens: [], chains: [], spreadBps: 10, feeBps: 10, fixedFeeUsd: 0, etaSec: 60, minUsd: 1, maxUsd: 1000, kinds: ["BUSINESS"], indiaAuth: "PA_CB_E", ...o });

describe("nothing on the Indian side touches crypto", () => {
  it("the mock catalogue satisfies the rule", () => { expect(() => assertIndiaFiatOnly(MOCK_LEGS)).not.toThrow(); });
  it("a live catalogue with a token or chain on an Indian leg is rejected", () => {
    expect(() => parseCatalog(JSON.stringify([leg({ tokens: ["USDC"] })]))).toThrow(/fiat only/);
    expect(() => parseCatalog(JSON.stringify([leg({ chains: ["base"] })]))).toThrow(/fiat only/);
    expect(() => parseCatalog(JSON.stringify([leg({ kind: "OFFRAMP", id: "in.off.x" })]))).toThrow(/fiat only/);
    expect(() => parseCatalog(JSON.stringify([leg({})]))).not.toThrow();
  });
  it("every route that ends in India carries tokens only on legs outside India", () => {
    for (const funding of ["STABLECOIN", "FIAT_LOCAL"] as const) {
      const routes = findRoutes({ kind: "BUSINESS", originCountry: "US", destCountry: "IN", sourceCurrency: "USD", destCurrency: "INR", amountUsd: 2000, fundingMethod: funding }, { legs: MOCK_LEGS });
      expect(routes.length).toBeGreaterThan(0);
      for (const r of routes) for (const l of r.legs) if (l.jurisdiction === "IN") { expect(l.tokens).toEqual([]); expect(l.chains).toEqual([]); }
    }
  });
});
