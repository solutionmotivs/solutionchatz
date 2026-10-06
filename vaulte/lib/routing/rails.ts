// Payment rails reachable THROUGH partners (Vaulte connects to none of these networks directly).
// ETAs are typical values for planning and display; real timing comes from the partner and cut-off times.

export interface RailInfo {
  label: string;
  region: string;
  /** Typical time until the beneficiary bank has the funds. */
  etaSec: number;
  instant: boolean;
  /** Operates 24/7/365 (false = banking days / cut-offs). */
  alwaysOn: boolean;
}

export const RAILS: Record<string, RailInfo> = {
  SWIFT: { label: "SWIFT", region: "Global", etaSec: 24 * 3600, instant: false, alwaysOn: false },
  SWIFT_SAMEDAY: { label: "SWIFT (same-day partner)", region: "Global", etaSec: 8 * 3600, instant: false, alwaysOn: false },
  SEPA: { label: "SEPA Credit Transfer", region: "EU/EEA", etaSec: 24 * 3600, instant: false, alwaysOn: false },
  SEPA_INSTANT: { label: "SEPA Instant", region: "EU/EEA", etaSec: 20, instant: true, alwaysOn: true },
  ACH: { label: "ACH", region: "US", etaSec: 2 * 24 * 3600, instant: false, alwaysOn: false },
  ACH_SAME_DAY: { label: "ACH same-day", region: "US", etaSec: 6 * 3600, instant: false, alwaysOn: false },
  FEDNOW: { label: "FedNow", region: "US", etaSec: 20, instant: true, alwaysOn: true },
  FEDWIRE: { label: "Fedwire", region: "US", etaSec: 2 * 3600, instant: false, alwaysOn: false },
  FASTER_PAYMENTS: { label: "Faster Payments", region: "UK", etaSec: 60, instant: true, alwaysOn: true },
  FAST: { label: "FAST", region: "Singapore", etaSec: 30, instant: true, alwaysOn: true },
  NPP: { label: "NPP / PayID", region: "Australia", etaSec: 30, instant: true, alwaysOn: true },
  FPS_HK: { label: "FPS", region: "Hong Kong", etaSec: 30, instant: true, alwaysOn: true },
  EFT_CA: { label: "EFT", region: "Canada", etaSec: 24 * 3600, instant: false, alwaysOn: false },
  ZENGIN: { label: "Zengin", region: "Japan", etaSec: 3600, instant: false, alwaysOn: true },
  UAEFTS: { label: "UAEFTS", region: "UAE", etaSec: 3600, instant: false, alwaysOn: false },
  IPP: { label: "Aani / IPP", region: "UAE", etaSec: 30, instant: true, alwaysOn: true },
  IMPS: { label: "IMPS", region: "India", etaSec: 30, instant: true, alwaysOn: true },
  UPI: { label: "UPI", region: "India", etaSec: 30, instant: true, alwaysOn: true },
  RTGS: { label: "RTGS", region: "India", etaSec: 1800, instant: false, alwaysOn: true },
  NEFT: { label: "NEFT", region: "India", etaSec: 2 * 3600, instant: false, alwaysOn: true },
  INTERAC: { label: "Interac e-Transfer / RTR", region: "Canada", etaSec: 90, instant: true, alwaysOn: true },
  CIPS: { label: "CIPS (offshore/onshore yuan clearing)", region: "China/HK", etaSec: 4 * 3600, instant: false, alwaysOn: false },
  ONCHAIN: { label: "On-chain", region: "Global", etaSec: 60, instant: true, alwaysOn: true },
};

export const SEPA_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO", "CH", "MC", "SM", "AD", "VA", "GB",
]);

/** Local rail to prefer when paying a bank in this currency/country; null = use SWIFT. */
export function localRailFor(currency: string, country: string, opts: { urgent?: boolean } = {}): string | null {
  const c = country.toUpperCase();
  switch (currency.toUpperCase()) {
    case "EUR": return SEPA_COUNTRIES.has(c) ? "SEPA_INSTANT" : null;
    case "GBP": return c === "GB" ? "FASTER_PAYMENTS" : null;
    case "USD": return c === "US" ? (opts.urgent ? "FEDNOW" : "ACH_SAME_DAY") : null;
    case "SGD": return c === "SG" ? "FAST" : null;
    case "AUD": return c === "AU" ? "NPP" : null;
    case "HKD": return c === "HK" ? "FPS_HK" : null;
    case "CAD": return c === "CA" ? (opts.urgent ? "INTERAC" : "EFT_CA") : null;
    case "CNH": return c === "HK" || c === "CN" ? "CIPS" : null;
    case "CNY": return c === "CN" ? "CIPS" : null;
    case "JPY": return c === "JP" ? "ZENGIN" : null;
    case "AED": return c === "AE" ? "UAEFTS" : null;
    default: return null;
  }
}

export function railEta(rail: string): number {
  return RAILS[rail]?.etaSec ?? RAILS.SWIFT.etaSec;
}
