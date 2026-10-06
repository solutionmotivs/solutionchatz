import { describe, expect, it } from "vitest";
import { MOCK_VA, vaOptions, vaPartnerFor } from "../lib/psp/capabilities";

describe("virtual account capabilities", () => {
  it("test mode: simulated partners for every open major, by country", () => {
    for (const [ccy, country, type] of [["EUR", "DE", "IBAN"], ["EUR", "FR", "IBAN"], ["GBP", "GB", "SORT_CODE"], ["USD", "US", "ACH_ROUTING"], ["CAD", "CA", "CA_TRANSIT"], ["AUD", "AU", "BSB"], ["JPY", "JP", "ACCOUNT_NUMBER"], ["HKD", "HK", "ACCOUNT_NUMBER"], ["CNH", "HK", "ACCOUNT_NUMBER"]]) {
      const m = vaPartnerFor(ccy, country, true);
      expect(m?.partner.startsWith("mock_"), `${ccy}/${country}`).toBe(true); expect(m?.capability.detailsType).toBe(type);
    }
  });
  it("a currency is tied to its country: no GBP account in Germany, no RUB anywhere", () => {
    expect(vaPartnerFor("GBP", "DE", true)).toBeNull(); expect(vaPartnerFor("RUB", "RU", true)).toBeNull(); expect(vaPartnerFor("EUR", "US", true)).toBeNull();
  });
  it("live mode never returns a mock, and returns nothing without live credentials", () => {
    expect(vaPartnerFor("EUR", "DE", false, {} as any)).toBeNull();
    expect(vaOptions(false, {} as any)).toEqual([]);
    expect(vaPartnerFor("USD", "US", false, { AIRWALLEX_ENV: "sandbox", AIRWALLEX_CLIENT_ID: "a", AIRWALLEX_API_KEY: "b" } as any)).toBeNull(); // sandbox keys never serve live customers
  });
  it("live mode uses a configured live partner and honours the operator's capability override", () => {
    const env = { AIRWALLEX_ENV: "live", AIRWALLEX_CLIENT_ID: "a", AIRWALLEX_API_KEY: "b" } as any;
    expect(vaPartnerFor("EUR", "NL", false, env)?.partner).toBe("airwallex");
    expect(vaPartnerFor("EUR", "NL", false, { ...env, PARTNER_VA_CAPABILITIES_JSON: JSON.stringify({ airwallex: [{ currency: "EUR", countries: ["DE"], detailsType: "IBAN", rails: ["SEPA"] }] }) })).toBeNull();
    expect(vaOptions(false, env).every(o => o.partner_kind === "licensed_partner")).toBe(true);
  });
  it("every mock partner entry declares rails", () => { for (const caps of Object.values(MOCK_VA)) for (const c of caps) expect(c.rails.length).toBeGreaterThan(0); });
});
