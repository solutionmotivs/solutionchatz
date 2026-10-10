import { describe, expect, it } from "vitest";
import { buildTiming, effectiveEtaSec, landsSameDay, waitForRailSec } from "../lib/routing/timing";
import { percentile, summarise } from "../lib/routing/settlement-metrics";
import { markupBpsFor, MIN_MARGIN_BPS } from "../lib/pricing";
import { findRoutes, rankRoutes } from "../lib/routing/engine";
import { MOCK_LEGS } from "../lib/routing/catalog";

const at = (iso: string) => Date.parse(iso);
const leg = (rails: string[], etaSec: number) => ({ id: "x", partner: "p", kind: "DIRECT", country: "US", jurisdiction: "US", rails, tokens: [], chains: [], spreadBps: 0, feeBps: 0, fixedFeeUsd: 0, etaSec, minUsd: 1, maxUsd: 1e6, kinds: ["BUSINESS"] }) as any;
const route = (legs: any[]) => ({ id: "r", legs, token: null, chain: null, partners: ["p"], spreadBps: 0, feeBps: 0, fixedFeeUsd: 0, etaSec: legs.reduce((s: number, l: any) => s + l.etaSec, 0), minUsd: 1, maxUsd: 1e6, usesStablecoin: false }) as any;

describe("cut-off aware timing", () => {
  it("always-on rails never wait; banking-day rails wait for the next window", () => {
    const sat = at("2026-10-10T12:00:00Z"); // Saturday
    expect(waitForRailSec("FEDNOW", sat)).toBe(0);
    expect(waitForRailSec("IMPS", sat)).toBe(0);
    expect(waitForRailSec("RTGS", sat)).toBe(0); // RBI RTGS is 24x7
    const w = waitForRailSec("SEPA", sat); // Mon 07:00 Berlin = 05:00Z, i.e. 41h away
    expect(w).toBeGreaterThan(40 * 3600); expect(w).toBeLessThan(42 * 3600);
  });
  it("a weekday morning is open, after the cut-off waits until the next day", () => {
    expect(waitForRailSec("ACH_SAME_DAY", at("2026-10-07T14:00:00Z"))).toBe(0); // Wed 10:00 New York
    const late = waitForRailSec("ACH_SAME_DAY", at("2026-10-07T20:00:00Z")); // Wed 16:00 New York, past the 14:00 cut-off
    expect(late).toBeGreaterThan(14 * 3600);
  });
  it("holidays from the environment close the window", () => {
    const env = { BANK_HOLIDAYS_US: "2026-10-07" } as any;
    expect(waitForRailSec("ACH_SAME_DAY", at("2026-10-07T14:00:00Z"), env)).toBeGreaterThan(0);
  });
  it("effective ETA adds the wait to the leg, and same-day is judged in the destination timezone", () => {
    const r = route([leg(["FEDNOW"], 30)]);
    const e = effectiveEtaSec(r, at("2026-10-10T12:00:00Z"));
    expect(e.seconds).toBe(30); expect(e.waitsForBanking).toBe(false);
    const slow = route([leg(["SWIFT"], 3600)]);
    expect(effectiveEtaSec(slow, at("2026-10-10T12:00:00Z")).waitsForBanking).toBe(true);
    expect(landsSameDay(30, "IN", at("2026-10-07T06:00:00Z"))).toBe(true);
    expect(landsSameDay(3 * 3600, "IN", at("2026-10-07T17:00:00Z"))).toBe(false); // 22:30 IST + 3h = next calendar day
  });
  it("timing says 'target' without enough samples and 'measured' with them, and never promises", () => {
    const r = route([leg(["IMPS"], 60)]);
    const t = buildTiming(r, "IN", null, at("2026-10-07T06:00:00Z"));
    expect(t.basis).toBe("target"); expect(t.note).toMatch(/not a guarantee/);
    const m = buildTiming(r, "IN", { samples: 12, p50_seconds: 95, p90_seconds: 400 }, at("2026-10-07T06:00:00Z"));
    expect(m.basis).toBe("measured"); expect(m.note).toMatch(/12 completed transfers/);
  });
  it("same_day preference ranks routes that land today first", () => {
    const routes = findRoutes({ kind: "BUSINESS", originCountry: "US", destCountry: "IN", sourceCurrency: "USD", destCurrency: "INR", amountUsd: 2000, fundingMethod: "STABLECOIN" }, { legs: MOCK_LEGS });
    expect(routes.length).toBeGreaterThan(0);
    const now = at("2026-10-07T06:00:00Z");
    const ranked = rankRoutes(routes, 2000, "same_day", { destCountry: "IN", now });
    const eff = (r: any) => effectiveEtaSec(r, now).seconds;
    const sameDay = (r: any) => landsSameDay(eff(r), "IN", now);
    const firstLate = ranked.findIndex(r => !sameDay(r));
    if (firstLate >= 0) expect(ranked.slice(firstLate).every(r => !sameDay(r))).toBe(true);
  });
});

describe("measured settlement statistics", () => {
  it("percentiles and the publish threshold", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(summarise([10, 20, 30, 40])).toBeNull(); // below MIN_SAMPLES
    expect(summarise([10, 20, 30, 40, 50])).toEqual({ samples: 5, p50_seconds: 30, p90_seconds: 50 });
  });
});

describe("per-corridor markup configuration", () => {
  const ov = [{ from: "US", to: "IN", kind: "BUSINESS", bps: 18 }, { to: "IN", bps: 25 }, { from: "*", to: "*", bps: 3 }] as any;
  it("most specific override wins, the floor still applies, and without a match the tiers apply", () => {
    expect(markupBpsFor("BUSINESS", 5000, undefined, { origin: "US", dest: "IN" }, ov)).toBe(18);
    expect(markupBpsFor("PERSONAL", 5000, undefined, { origin: "US", dest: "IN" }, ov)).toBe(25);
    expect(markupBpsFor("BUSINESS", 5000, undefined, { origin: "GB", dest: "DE" }, ov)).toBe(MIN_MARGIN_BPS);
    expect(markupBpsFor("BUSINESS", 5000, undefined, { origin: "GB", dest: "DE" }, [])).toBe(40);
  });
});
