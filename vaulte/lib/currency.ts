// Currency registry: which currencies Vaulte can quote, how many decimals they use, and which are closed.
// "Closed" is a legal decision, not a technical one: RUB and the other currencies below are refused until counsel clears a lawful structure.

export interface CurrencyInfo {
  code: string;
  name: string;
  /** Digits after the decimal point in minor units (JPY/KRW = 0). Everything stored as "minor" uses this exponent. */
  exp: number;
  /** Home country (ISO-2) used for rail/timezone hints; offshore CNH is Hong Kong. */
  country: string;
  note?: string;
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  USD: { code: "USD", name: "US dollar", exp: 2, country: "US" },
  EUR: { code: "EUR", name: "Euro", exp: 2, country: "DE" },
  GBP: { code: "GBP", name: "Pound sterling", exp: 2, country: "GB" },
  INR: { code: "INR", name: "Indian rupee", exp: 2, country: "IN", note: "Paid out only through RBI-authorised partners" },
  AED: { code: "AED", name: "UAE dirham", exp: 2, country: "AE" },
  SGD: { code: "SGD", name: "Singapore dollar", exp: 2, country: "SG" },
  CAD: { code: "CAD", name: "Canadian dollar", exp: 2, country: "CA" },
  AUD: { code: "AUD", name: "Australian dollar", exp: 2, country: "AU" },
  NZD: { code: "NZD", name: "New Zealand dollar", exp: 2, country: "NZ" },
  JPY: { code: "JPY", name: "Japanese yen", exp: 0, country: "JP", note: "No decimals: amounts are whole yen" },
  CNH: { code: "CNH", name: "Chinese yuan (offshore, Hong Kong)", exp: 2, country: "HK", note: "Offshore yuan settles through Hong Kong partners; typically slower than other majors" },
  CNY: { code: "CNY", name: "Chinese yuan (onshore)", exp: 2, country: "CN", note: "Onshore yuan: fiat only (no stablecoin), subject to China's capital-account controls; slower and limited by partner" },
  HKD: { code: "HKD", name: "Hong Kong dollar", exp: 2, country: "HK" },
  CHF: { code: "CHF", name: "Swiss franc", exp: 2, country: "CH" },
  SEK: { code: "SEK", name: "Swedish krona", exp: 2, country: "SE" },
  NOK: { code: "NOK", name: "Norwegian krone", exp: 2, country: "NO" },
  DKK: { code: "DKK", name: "Danish krone", exp: 2, country: "DK" },
  PLN: { code: "PLN", name: "Polish zloty", exp: 2, country: "PL" },
  SAR: { code: "SAR", name: "Saudi riyal", exp: 2, country: "SA" },
  MYR: { code: "MYR", name: "Malaysian ringgit", exp: 2, country: "MY" },
  NPR: { code: "NPR", name: "Nepalese rupee", exp: 2, country: "NP", note: "Receive-only through licensed channels (NRB rules)" },
};

/** Closed by default: sanctions/legal perimeter. Override only on written counsel advice: CLOSED_CURRENCIES=RUB,BYN. */
export const DEFAULT_CLOSED_CURRENCIES = ["RUB", "BYN", "IRR", "KPW", "SYP", "CUP"];
/** Countries whose payments are closed regardless of mode (in addition to the hard sanctions blocks in lib/compliance/aml.ts). */
export const DEFAULT_CLOSED_COUNTRIES = ["RU", "BY"];

const list = (v: string | undefined, d: string[]) => (v === undefined ? d : v.split(",").map(s => s.trim().toUpperCase()).filter(Boolean));
export const closedCurrencies = (env: NodeJS.ProcessEnv = process.env) => new Set(list(env.CLOSED_CURRENCIES, DEFAULT_CLOSED_CURRENCIES));
export const closedCountryList = (env: NodeJS.ProcessEnv = process.env) => new Set(list(env.CLOSED_COUNTRIES, DEFAULT_CLOSED_COUNTRIES));

export type CurrencyStatus = "OPEN" | "CLOSED" | "UNKNOWN";
export function currencyStatus(code: string, env: NodeJS.ProcessEnv = process.env): CurrencyStatus {
  const c = code.toUpperCase();
  if (closedCurrencies(env).has(c)) return "CLOSED";
  return CURRENCIES[c] ? "OPEN" : "UNKNOWN";
}

export const expOf = (code: string) => CURRENCIES[code.toUpperCase()]?.exp ?? 2;
export const minorToMajor = (minor: number | bigint, code: string) => Number(minor) / 10 ** expOf(code);
export const majorToMinor = (major: number, code: string) => Math.round(major * 10 ** expOf(code));
export function fmtMinor(minor: number | bigint, code: string, locale = "en-US") {
  return new Intl.NumberFormat(locale, { style: "currency", currency: code.toUpperCase(), minimumFractionDigits: expOf(code), maximumFractionDigits: expOf(code) }).format(minorToMajor(minor, code));
}
/** Decimal string for partner APIs (e.g. "150000" for JPY, "1500.00" for USD). */
export const majorString = (minor: number | bigint, code: string) => minorToMajor(minor, code).toFixed(expOf(code));
