import { describe, expect, it } from "vitest";
import { indiaRailLimits, pickIndiaRail, validateUpiId } from "../lib/routing/india-rails";

const all = ["UPI", "IMPS", "RTGS", "NEFT"];
describe("India payout rail", () => {
  it("uses UPI for small amounts when the receiver has a UPI ID", () => {
    expect(pickIndiaRail(50_000, all, { hasUpiId: true })).toMatchObject({ rail: "UPI", instant: true });
  });
  it("falls to IMPS without a UPI ID, or above the UPI ceiling", () => {
    expect(pickIndiaRail(50_000, all, { hasUpiId: false }).rail).toBe("IMPS");
    expect(pickIndiaRail(150_000, all, { hasUpiId: true }).rail).toBe("IMPS");
    expect(pickIndiaRail(50_000, all).reason).not.toMatch(/undefined/);
  });
  it("uses RTGS above the IMPS ceiling and NEFT only when nothing else fits", () => {
    expect(pickIndiaRail(2_000_000, all, { hasUpiId: true })).toMatchObject({ rail: "RTGS", instant: false });
    expect(pickIndiaRail(2_000_000, ["IMPS", "NEFT"]).rail).toBe("NEFT");
  });
  it("respects what the partner supports and falls back rather than failing", () => {
    expect(pickIndiaRail(10_000, ["RTGS"]).rail).toBe("RTGS");
    expect(pickIndiaRail(10_000, []).rail).toBe("IMPS");
    expect(pickIndiaRail(50_000, ["IMPS", "UPI"], { hasUpiId: true }).alternatives).toEqual(["IMPS"]);
  });
  it("limits are configurable and ignore junk", () => {
    expect(indiaRailLimits({ UPI_LIMIT_INR: "500000" } as unknown as NodeJS.ProcessEnv).upiMax).toBe(500_000);
    expect(indiaRailLimits({ UPI_LIMIT_INR: "abc" } as unknown as NodeJS.ProcessEnv).upiMax).toBe(100_000);
  });
  it("validates UPI IDs", () => {
    for (const ok of ["priya@okhdfcbank", "a.b-c_d@paytm", "9876543210@ybl"]) expect(validateUpiId(ok)).toBeNull();
    for (const bad of ["priya", "@bank", "pri ya@bank", "priya@", "priya@1bank"]) expect(validateUpiId(bad)).not.toBeNull();
  });
});
