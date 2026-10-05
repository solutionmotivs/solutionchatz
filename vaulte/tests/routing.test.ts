import { describe, expect, it } from "vitest";
import { findRoutes, rankRoutes, nextRoute, pickAlternates, routeCostUsd, type RouteRequest } from "@/lib/routing/engine";

const req = (over: Partial<RouteRequest> = {}): RouteRequest => ({
  kind: "BUSINESS", originCountry: "DE", destCountry: "IN", sourceCurrency: "EUR", destCurrency: "INR",
  amountUsd: 5_000, fundingMethod: "FIAT_LOCAL", ...over,
});

describe("route engine", () => {
  it("builds fiat-in -> stablecoin -> hub fiat -> INR routes for EUR -> India", () => {
    const routes = findRoutes(req());
    expect(routes.length).toBeGreaterThan(0);
    const r = routes[0];
    expect(r.legs[r.legs.length - 1].kind).toBe("INDIA_PAYOUT");
    expect(r.legs[r.legs.length - 1].indiaAuth).toBe("PA_CB_E");
  });

  it("never selects USDT when an EU-licensed leg is involved (MiCA)", () => {
    const routes = findRoutes(req());
    for (const r of routes) {
      if (r.legs.some(l => l.jurisdiction === "EU")) expect(r.token).not.toBe("USDT");
    }
    // forcing USDT with an EU funding leg yields no EU route
    const forced = findRoutes(req({ token: "USDT" }));
    expect(forced.every(r => !r.legs.some(l => l.jurisdiction === "EU"))).toBe(true);
  });

  it("India-origin routes are fiat only", () => {
    const routes = findRoutes(req({ originCountry: "IN", destCountry: "US", sourceCurrency: "INR", destCurrency: "USD", amountUsd: 1_000 }));
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.every(r => !r.usesStablecoin && r.token === null)).toBe(true);
  });

  it("cheapest and fastest preferences can pick different routes", () => {
    const routes = findRoutes(req({ originCountry: "US", sourceCurrency: "USD", destCurrency: "INR", amountUsd: 2_000 }));
    const cheapest = rankRoutes(routes, 2_000, "cheapest")[0];
    const fastest = rankRoutes(routes, 2_000, "fastest")[0];
    expect(routeCostUsd(cheapest, 2_000)).toBeLessThanOrEqual(routeCostUsd(fastest, 2_000));
    expect(fastest.etaSec).toBeLessThanOrEqual(cheapest.etaSec);
  });

  it("fails over to a route that avoids the failed partner", () => {
    const ranked = rankRoutes(findRoutes(req()), 5_000, "cheapest");
    const first = ranked[0];
    const next = nextRoute(ranked, [first.partners[0]]);
    expect(next).not.toBeNull();
    expect(next!.partners).not.toContain(first.partners[0]);
  });

  it("falls back to fiat-only into India when stablecoin legs are unavailable", () => {
    const down = ["mock_us", "mock_uae", "mock_sg", "mock_uk", "mock_eu", "mock_us_b", "mock_uae_b", "mock_sg_b", "mock_uk_b", "mock_eu_b"];
    const routes = findRoutes(req({ originCountry: "US", sourceCurrency: "USD", amountUsd: 1_000 }), { unavailablePartners: down });
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.every(r => !r.usesStablecoin)).toBe(true); // only the fiat-only route is left
    const withFiat = findRoutes(req({ originCountry: "US", sourceCurrency: "USD", amountUsd: 1_000 }));
    expect(withFiat.some(r => r.usesStablecoin)).toBe(true);
  });

  it("same-currency domestic corridors use direct local rails with no stablecoin", () => {
    const routes = findRoutes(req({ originCountry: "DE", destCountry: "FR", sourceCurrency: "EUR", destCurrency: "EUR", amountUsd: 500 }));
    const best = rankRoutes(routes, 500, "cheapest")[0];
    expect(best.usesStablecoin).toBe(false);
    expect(best.legs[0].rails).toContain("SEPA_INSTANT");
  });

  it("respects personal MTSS capacity for personal inbound", () => {
    const personal = findRoutes(req({ kind: "PERSONAL", sourceCurrency: "USD", originCountry: "US", amountUsd: 2_000 }));
    expect(personal.every(r => r.legs[r.legs.length - 1].indiaAuth === "MTSS")).toBe(true);
    expect(findRoutes(req({ kind: "PERSONAL", sourceCurrency: "USD", originCountry: "US", amountUsd: 3_000 })).length).toBe(0);
  });

  it("an explicit token request excludes fiat-only and other-token routes", () => {
    const routes = findRoutes(req({ originCountry: "US", sourceCurrency: "USD", amountUsd: 2_000, token: "USDT" }));
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.every(r => r.token === "USDT")).toBe(true);
  });

  it("keeps a same-funding alternate with a different payout partner for failover", () => {
    const ranked = rankRoutes(findRoutes(req({ originCountry: "US", sourceCurrency: "USD", fundingMethod: "STABLECOIN", amountUsd: 3_000 })), 3_000, "cheapest");
    const chosen = ranked[0];
    const alts = pickAlternates(ranked, chosen);
    const last = (r: typeof chosen) => r.legs[r.legs.length - 1].partner;
    expect(alts.some(a => a.legs[0].partner === chosen.legs[0].partner && last(a) !== last(chosen))).toBe(true);
  });

  it("stablecoin funding only uses deposit-accepting legs", () => {
    const routes = findRoutes(req({ originCountry: "AE", sourceCurrency: "USD", fundingMethod: "STABLECOIN", amountUsd: 3_000 }));
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.every(r => r.legs[0].kind === "ACCEPT_TOKEN")).toBe(true);
  });
});
