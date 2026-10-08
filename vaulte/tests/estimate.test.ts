import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/stablecoin/rates", () => ({
  getRateTable: async (cs: string[]) => ({ USD: 1, INR: 83.4, EUR: 0.92, AED: 3.6725, GBP: 0.79, ...Object.fromEntries(cs.map(c => [c, ({ INR: 83.4, EUR: 0.92, AED: 3.6725, GBP: 0.79, USD: 1 } as Record<string, number>)[c] ?? 1])) }),
  RateUnavailableError: class extends Error {},
}));
vi.mock("../lib/routing/settlement-metrics", () => ({ corridorTiming: async () => null }));

import { EstimateError, estimate } from "../lib/public/estimate";
import { feeSplit } from "../lib/pricing/split";

const base = { originCountry: "US", destCountry: "IN", sourceCurrency: "USD", destCurrency: "INR", amount: 5000, kind: "BUSINESS" as const, funding: "FIAT_LOCAL" as const };
beforeEach(() => { delete process.env.PARTNER_CATALOG_JSON; delete process.env.PARTNER_CATALOG_FILE; });

describe("public estimate", () => {
  it("returns a test-mode estimate with the full cost stack, timing and an India certificate note", async () => {
    const r = await estimate(base);
    expect(r.mode).toBe("test");
    expect(r.options.length).toBeGreaterThan(0);
    const o = r.options[0] as any;
    expect(o.fees.partner_cost_usd + o.fees.vaulte_fee_usd).toBeCloseTo(o.fees.total_usd, 2);
    expect(o.fees.collection).toBe("PARTNER_SHARE");
    expect(o.they_receive.currency).toBe("INR");
    expect(o.they_receive.amount_minor).toBeGreaterThan(0);
    expect(o.timing.basis).toBe("target"); // simulated transfers never count as measured speed
    expect(r.certificate).toMatch(/does not issue certificates/);
    expect(r.disclaimer).toMatch(/Test-mode/);
  });
  it("never offers a stablecoin leg inside India", async () => {
    const r = await estimate({ ...base, funding: "STABLECOIN", sourceCurrency: "USD" });
    for (const o of r.options as any[]) for (const l of o.route.legs) if (l.country === "IN") expect(["INDIA_PAYOUT"]).toContain(l.kind);
  });
  it("refuses closed currencies and countries, and mismatched tokens", async () => {
    await expect(estimate({ ...base, destCurrency: "RUB", destCountry: "RU" })).rejects.toMatchObject({ code: "CURRENCY_CLOSED" });
    await expect(estimate({ ...base, destCountry: "RU" })).rejects.toMatchObject({ code: "COUNTRY_CLOSED" });
    await expect(estimate({ ...base, funding: "STABLECOIN", token: "EURC" })).rejects.toBeInstanceOf(EstimateError);
  });
  it("splits the fee into partner cost and Vaulte fee", () => {
    const s = feeSplit({ partnerCostUsd: 10, markupUsd: 15, markupBps: 30, totalCostUsd: 25, totalCostBps: 50 } as any);
    expect(s).toMatchObject({ partner_cost_usd: 10, vaulte_fee_usd: 15, vaulte_fee_bps: 30, total_usd: 25, collection: "PARTNER_SHARE" });
  });
});
