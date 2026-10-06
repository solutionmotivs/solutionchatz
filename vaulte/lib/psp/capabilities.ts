// What each partner can issue as local receiving details (virtual accounts). Vaulte holds nothing: the licensed partner issues
// and holds the account in the account holder's name, and every credit is converted and paid out at once (no balances).
//
// Live capabilities below come from the partners' PUBLIC documentation as understood in October 2026 and are NOT verified against
// your accounts: partners enable currencies per account and per country of the holder. Override with PARTNER_VA_CAPABILITIES_JSON
// (the contract is the source of truth), e.g. {"airwallex":[{"currency":"EUR","countries":["DE","FR"],"detailsType":"IBAN"}]}.
import { isEuCountry } from "@/lib/kyc/validators";
import { airwallexFromEnv } from "@/lib/psp/airwallex/client";
import { currencycloudFromEnv } from "@/lib/psp/currencycloud/client";

export interface VaCapability { currency: string; /** Countries of the account (empty = any). */ countries: string[]; detailsType: string; rails: string[] }
export type VaTable = Record<string, VaCapability[]>;

const EU_ALL = "EU"; // marker meaning "any EU/EEA country" in the tables below
const cap = (currency: string, countries: string[], detailsType: string, rails: string[]): VaCapability => ({ currency, countries, detailsType, rails });

/** Test mode: simulated partners, so every open currency can be tried. */
export const MOCK_VA: VaTable = {
  mock_eu: [cap("EUR", [EU_ALL], "IBAN", ["SEPA", "SEPA_INSTANT"])],
  mock_uk: [cap("GBP", ["GB"], "SORT_CODE", ["FASTER_PAYMENTS"])],
  mock_us: [cap("USD", ["US"], "ACH_ROUTING", ["ACH", "FEDWIRE", "FEDNOW"])],
  mock_uae: [cap("AED", ["AE"], "IBAN", ["UAEFTS", "IPP"])],
  mock_sg: [cap("SGD", ["SG"], "ACCOUNT_NUMBER", ["FAST"])],
  mock_ca: [cap("CAD", ["CA"], "CA_TRANSIT", ["EFT_CA", "INTERAC"])],
  mock_au: [cap("AUD", ["AU"], "BSB", ["NPP"])],
  mock_jp: [cap("JPY", ["JP"], "ACCOUNT_NUMBER", ["ZENGIN"])],
  mock_hk: [cap("HKD", ["HK"], "ACCOUNT_NUMBER", ["FPS_HK"]), cap("CNH", ["HK"], "ACCOUNT_NUMBER", ["CIPS"])],
};

/** Live defaults per adapter (documented, unverified). Wise is deliberately absent: its adapter does not provision account details. */
export const LIVE_VA_DEFAULTS: VaTable = {
  airwallex: [
    cap("USD", ["US"], "ACH_ROUTING", ["ACH", "FEDWIRE"]), cap("EUR", [EU_ALL], "IBAN", ["SEPA"]), cap("GBP", ["GB"], "SORT_CODE", ["FASTER_PAYMENTS"]),
    cap("AUD", ["AU"], "BSB", ["NPP"]), cap("CAD", ["CA"], "CA_TRANSIT", ["EFT_CA"]), cap("HKD", ["HK"], "ACCOUNT_NUMBER", ["FPS_HK"]),
    cap("SGD", ["SG"], "ACCOUNT_NUMBER", ["FAST"]), cap("JPY", ["JP"], "ACCOUNT_NUMBER", ["ZENGIN"]), cap("CNH", ["HK"], "ACCOUNT_NUMBER", ["CIPS"]),
  ],
  currencycloud: [cap("GBP", ["GB"], "SORT_CODE", ["FASTER_PAYMENTS"]), cap("EUR", [EU_ALL], "IBAN", ["SEPA"]), cap("USD", ["US"], "ACH_ROUTING", ["ACH", "FEDWIRE"])],
};

function liveTable(env: NodeJS.ProcessEnv): VaTable {
  if (env.PARTNER_VA_CAPABILITIES_JSON) { try { const j = JSON.parse(env.PARTNER_VA_CAPABILITIES_JSON); if (j && typeof j === "object") return j as VaTable; } catch { /* fall through to defaults */ } }
  return LIVE_VA_DEFAULTS;
}

/** A live partner counts only when its credentials are present AND its environment is live (test keys never serve live customers). */
export function liveConfigured(partner: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (partner === "airwallex") return !!airwallexFromEnv(env) && env.AIRWALLEX_ENV === "live";
  if (partner === "currencycloud") return !!currencycloudFromEnv(env) && env.CURRENCYCLOUD_ENV === "live";
  return false;
}

const countryOk = (c: VaCapability, country: string) => c.countries.length === 0 || c.countries.includes(country) || (c.countries.includes(EU_ALL) && isEuCountry(country));

export interface VaMatch { partner: string; capability: VaCapability }

/** The partner that can issue this currency/country in this mode, or null. Sandbox never returns a live partner and live never returns a mock. */
export function vaPartnerFor(currency: string, country: string, sandbox: boolean, env: NodeJS.ProcessEnv = process.env): VaMatch | null {
  const table = sandbox ? MOCK_VA : liveTable(env);
  for (const [partner, caps] of Object.entries(table)) {
    if (!sandbox && (partner.startsWith("mock_") || !liveConfigured(partner, env))) continue;
    const c = caps.find(x => x.currency === currency && countryOk(x, country));
    if (c) return { partner, capability: c };
  }
  return null;
}

export interface VaOption { currency: string; countries: string[]; details_type: string; rails: string[]; partner_kind: "simulated" | "licensed_partner" }
/** What the dashboard offers in this mode. Partner ids are not exposed in test mode (they are mocks) beyond the kind. */
export function vaOptions(sandbox: boolean, env: NodeJS.ProcessEnv = process.env): VaOption[] {
  const table = sandbox ? MOCK_VA : liveTable(env);
  const out: VaOption[] = [];
  for (const [partner, caps] of Object.entries(table)) {
    if (!sandbox && (partner.startsWith("mock_") || !liveConfigured(partner, env))) continue;
    for (const c of caps) out.push({ currency: c.currency, countries: c.countries.map(x => (x === EU_ALL ? "EU/EEA" : x)), details_type: c.detailsType, rails: c.rails, partner_kind: sandbox ? "simulated" : "licensed_partner" });
  }
  return out;
}
