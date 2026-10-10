import { describe, expect, it } from "vitest";
import { closedCountryList, closedCurrencies, currencyStatus, expOf, fmtMinor, majorString, majorToMinor, minorToMajor } from "../lib/currency";
import { toUsd } from "../lib/pricing";
import { localRailFor } from "../lib/routing/rails";

describe("currency registry", () => {
  it("yen has no decimals, everything else two", () => {
    expect(expOf("JPY")).toBe(0); expect(expOf("USD")).toBe(2); expect(expOf("CNH")).toBe(2);
    expect(minorToMajor(150000, "JPY")).toBe(150000); expect(minorToMajor(150000, "USD")).toBe(1500);
    expect(majorToMinor(1500.5, "USD")).toBe(150050); expect(majorToMinor(1500, "JPY")).toBe(1500);
    expect(majorString(150000, "JPY")).toBe("150000"); expect(majorString(150000, "USD")).toBe("1500.00");
  });
  it("USD value of a yen amount uses whole yen", () => {
    expect(toUsd(150000, "JPY", { USD: 1, JPY: 150 })).toBeCloseTo(1000, 6);
    expect(toUsd(100000, "EUR", { USD: 1, EUR: 0.92 })).toBeCloseTo(1000 / 0.92, 6);
  });
  it("formats by the currency's own decimals", () => {
    expect(fmtMinor(150000, "JPY")).toMatch(/150,000/); expect(fmtMinor(150000, "JPY")).not.toMatch(/\./);
    expect(fmtMinor(150000, "USD")).toMatch(/1,500\.00/);
  });
  it("RUB and the sanctioned currencies are closed by default; the operator can only replace the list explicitly", () => {
    expect(currencyStatus("RUB")).toBe("CLOSED"); expect(currencyStatus("IRR")).toBe("CLOSED");
    expect(currencyStatus("CAD")).toBe("OPEN"); expect(currencyStatus("XYZ")).toBe("UNKNOWN");
    expect(closedCountryList().has("RU")).toBe(true); expect(closedCountryList().has("BY")).toBe(true);
    expect(closedCurrencies({ CLOSED_CURRENCIES: "RUB" } as any).has("BYN")).toBe(false);
  });
  it("local rails for the new majors", () => {
    expect(localRailFor("CNH", "HK")).toBe("CIPS"); expect(localRailFor("CAD", "CA", { urgent: true })).toBe("INTERAC");
    expect(localRailFor("JPY", "JP")).toBe("ZENGIN"); expect(localRailFor("AUD", "AU")).toBe("NPP");
  });
});
