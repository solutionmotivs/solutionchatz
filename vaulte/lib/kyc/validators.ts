// Format and checksum validators for identifiers collected during KYC/KYB.
// These catch typos before a paid provider lookup; they do NOT prove the identifier belongs to the applicant.

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
/** 4th character of a PAN = holder type. P = individual; everything else = non-individual. */
const PAN_NON_INDIVIDUAL = new Set(["C", "H", "F", "A", "T", "B", "L", "J", "G"]);

export function normalise(v: string): string {
  return v.replace(/\s+/g, "").toUpperCase();
}

export function validatePan(v: string, holder: "INDIVIDUAL" | "BUSINESS"): string | null {
  const pan = normalise(v);
  if (!PAN_RE.test(pan)) return "PAN must look like ABCDE1234F";
  const t = pan[3];
  if (holder === "INDIVIDUAL" && t !== "P") return "An individual's PAN has P as its 4th letter";
  if (holder === "BUSINESS" && !PAN_NON_INDIVIDUAL.has(t)) return "A business PAN does not have P as its 4th letter";
  return null;
}

const GST_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** GSTIN: 2-digit state, 10-char PAN, entity no., 'Z', check character (mod-36 checksum). */
export function validateGstin(v: string): string | null {
  const g = normalise(v);
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return "GSTIN must be 15 characters, e.g. 24ABKCS2033B1ZV";
  const state = Number(g.slice(0, 2));
  if (state < 1 || state > 99) return "GSTIN has an invalid state code";
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GST_CHARS.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  const check = GST_CHARS[(36 - (sum % 36)) % 36];
  return check === g[14] ? null : "GSTIN check character does not match";
}

export function validateCin(v: string): string | null {
  const c = normalise(v);
  if (/^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/.test(c)) return null;
  if (/^[A-Z]{3}-[0-9]{4}$/.test(c)) return null; // LLPIN
  return "Enter a 21-character CIN (e.g. U12345MH2020PTC123456) or an LLPIN (AAA-1234)";
}

export function validateIec(v: string): string | null {
  return /^[A-Z0-9]{10}$/.test(normalise(v)) ? null : "IEC has 10 letters/digits";
}

export function validateIfsc(v: string): string | null {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalise(v)) ? null : "IFSC must look like HDFC0001234";
}

export function validateEin(v: string): string | null {
  return /^\d{2}-?\d{7}$/.test(v.trim()) ? null : "EIN must look like 12-3456789";
}

/** ISO 13616 IBAN: country + check digits + BBAN, mod-97 must equal 1. */
export function validateIban(v: string): string | null {
  const s = normalise(v);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(s)) return "IBAN format is not valid";
  const re = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of re) {
    const n = /[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of n) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1 ? null : "IBAN check digits do not match";
}

/** US ABA routing number: 9 digits, weights 3-7-1. */
export function validateAba(v: string): string | null {
  const s = v.trim();
  if (!/^\d{9}$/.test(s)) return "Routing number has 9 digits";
  const w = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  const sum = [...s].reduce((a, d, i) => a + Number(d) * w[i], 0);
  return sum % 10 === 0 ? null : "Routing number check digit does not match";
}

/** LEI (ISO 17442): 20 characters, ISO 7064 mod 97-10. */
export function validateLei(v: string): string | null {
  const s = normalise(v);
  if (!/^[A-Z0-9]{18}[0-9]{2}$/.test(s)) return "LEI has 20 characters";
  let rem = 0;
  for (const ch of s) {
    const n = /[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of n) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1 ? null : "LEI check digits do not match";
}

export function validateUkCompany(v: string): string | null {
  return /^([0-9]{8}|[A-Z]{2}[0-9]{6})$/.test(normalise(v)) ? null : "UK company number has 8 characters (e.g. 01234567 or SC123456)";
}

export function validateGenericReg(v: string): string | null {
  return /^[A-Za-z0-9\-/. ]{3,40}$/.test(v.trim()) ? null : "Enter the registration number as shown on the registry extract (3-40 characters)";
}

const IBAN_COUNTRIES = new Set(["GB", "CH", "NO", "AE", "SA", "QA", "KW", "BH", "TR", "IL", "EG", "PK", "LI", "IS", "SM", "MC", "AD", "JO", "LB", "CR", "BR", "PS", "VG", "MU", "LC", "KZ", "AZ", "BA", "GE", "XK", "MD", "ME", "MK", "RS", "UA", "AL", "BY", "DO", "GT", "IQ", "LY", "SC", "SD", "SV", "TL", "VA", "FO", "GL", "GI", "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"]);

/** Bank account value formats: India "IFSC|account", US "ABA|account", Australia "BSB|account", IBAN countries an IBAN, others "BIC|account". */
export function validateBankAccount(v: string, country: string): string | null {
  const raw = v.trim();
  if (country === "IN") {
    const [ifsc, acct] = raw.split("|");
    return validateIfsc(ifsc ?? "") ?? (/^[0-9]{6,20}$/.test((acct ?? "").trim()) ? null : "Indian account numbers have 6-20 digits");
  }
  if (country === "US") {
    const [aba, acct] = raw.split("|");
    return validateAba(aba ?? "") ?? (/^[0-9]{4,17}$/.test((acct ?? "").trim()) ? null : "US account numbers have 4-17 digits");
  }
  if (country === "AU") {
    const [bsb, acct] = raw.split("|");
    return /^\d{3}-?\d{3}$/.test((bsb ?? "").trim()) && /^\d{6,9}$/.test((acct ?? "").trim()) ? null : "Australian accounts look like BSB|account, e.g. 062000|12345678";
  }
  if (IBAN_COUNTRIES.has(country)) return validateIban(raw);
  // Countries without IBAN (e.g. Malaysia, Nepal): the bank's SWIFT/BIC and the account number.
  const [bic, acct] = raw.split("|");
  return /^[A-Za-z]{4}[A-Za-z]{2}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$/.test((bic ?? "").trim()) && /^[A-Za-z0-9]{5,34}$/.test((acct ?? "").trim()) ? null : "Enter the bank's SWIFT/BIC and your account number as BIC|account, e.g. MBBEMYKL|514012345678";
}

/** Keeps the last 4 characters; the rest is starred. */
export function mask(v: string): string {
  const s = v.replace(/\s+/g, "");
  if (s.length <= 4) return "*".repeat(s.length);
  return "*".repeat(Math.min(s.length - 4, 12)) + s.slice(-4);
}

// ---- Country packs (M10): format/checksum checks for identifiers outside India/US/UK ----

const digits = (v: string) => v.replace(/[\s-]/g, "");

function luhn(s: string): boolean {
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    let d = Number(s[s.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Australian Business Number: 11 digits, weighted checksum mod 89. */
export function validateAbn(v: string): string | null {
  const s = digits(v);
  if (!/^\d{11}$/.test(s)) return "ABN has 11 digits";
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const sum = [...s].reduce((a, d, i) => a + (i === 0 ? Number(d) - 1 : Number(d)) * w[i], 0);
  return sum % 89 === 0 ? null : "ABN check digits do not match";
}

/** Australian Company Number: 9 digits, complement-of-weighted-sum check digit. */
export function validateAcn(v: string): string | null {
  const s = digits(v);
  if (!/^\d{9}$/.test(s)) return "ACN has 9 digits";
  const sum = [...s.slice(0, 8)].reduce((a, d, i) => a + Number(d) * (8 - i), 0);
  return (10 - (sum % 10)) % 10 === Number(s[8]) ? null : "ACN check digit does not match";
}

/** UAE tax registration number (VAT TRN): 15 digits, normally starting 100. */
export function validateUaeTrn(v: string): string | null {
  return /^\d{15}$/.test(digits(v)) ? null : "UAE TRN has 15 digits";
}
/** UAE trade licence numbers are issued per emirate/free zone with no common format. */
export function validateTradeLicence(v: string): string | null {
  return /^[A-Za-z0-9\-/. ]{4,30}$/.test(v.trim()) ? null : "Enter the trade licence number as printed on the licence";
}

/** Saudi Commercial Registration (Ministry of Commerce): 10 digits. */
export function validateSaCr(v: string): string | null {
  return /^[1-7]\d{9}$/.test(digits(v)) ? null : "Saudi Commercial Registration number has 10 digits";
}
/** Saudi VAT number: 15 digits, starts and ends with 3. */
export function validateSaVat(v: string): string | null {
  return /^3\d{13}3$/.test(digits(v)) ? null : "Saudi VAT number has 15 digits, starting and ending with 3";
}

/** Malaysian company registration (SSM): 12 digits (since 2017) or the older 123456-X form. */
export function validateMyBrn(v: string): string | null {
  const s = v.replace(/\s/g, "").toUpperCase();
  return /^\d{12}$/.test(s) || /^\d{5,7}-?[A-Z]$/.test(s) ? null : "SSM registration number has 12 digits (e.g. 201901234567) or the old form 123456-X";
}

/** Nepal PAN/VAT (Inland Revenue Department): 9 digits. */
export function validateNepalPan(v: string): string | null {
  return /^\d{9}$/.test(digits(v)) ? null : "Nepal PAN/VAT number has 9 digits";
}

/** Number part of a VAT ID per EU member state (the VIES list; Greece = EL). Format only; VIES confirms existence. */
const EU_VAT: Record<string, RegExp> = {
  AT: /^U\d{8}$/, BE: /^[01]\d{9}$/, BG: /^\d{9,10}$/, HR: /^\d{11}$/, CY: /^\d{8}[A-Z]$/, CZ: /^\d{8,10}$/, DK: /^\d{8}$/, EE: /^\d{9}$/,
  FI: /^\d{8}$/, FR: /^[A-Z0-9]{2}\d{9}$/, DE: /^\d{9}$/, GR: /^\d{9}$/, HU: /^\d{8}$/, IE: /^(\d{7}[A-Z]{1,2}|\d[A-Z+*]\d{5}[A-Z])$/, IT: /^\d{11}$/,
  LV: /^\d{11}$/, LT: /^(\d{9}|\d{12})$/, LU: /^\d{8}$/, MT: /^\d{8}$/, NL: /^\d{9}B\d{2}$/, PL: /^\d{10}$/, PT: /^\d{9}$/, RO: /^\d{2,10}$/,
  SK: /^\d{10}$/, SI: /^\d{8}$/, ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/, SE: /^\d{12}$/, XI: /^(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
};
export const EU_COUNTRIES = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];
export const isEuCountry = (c: string) => EU_COUNTRIES.includes(c);

/** Strip a leading country prefix (EL for Greece) and return the number part. */
export function euVatNumber(country: string, v: string): string {
  const s = normalise(v).replace(/[.\-]/g, "");
  const prefix = country === "GR" ? "EL" : country;
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}
export function validateEuVat(country: string): (v: string) => string | null {
  return v => {
    const re = EU_VAT[country];
    if (!re) return "VAT numbers are not issued in this country";
    return re.test(euVatNumber(country, v)) ? null : `Enter the ${country === "GR" ? "EL" : country} VAT number (e.g. ${country === "GR" ? "EL" : country}${EU_VAT_EXAMPLE[country] ?? "123456789"})`;
  };
}
const EU_VAT_EXAMPLE: Record<string, string> = { DE: "123456789", FR: "12345678901", NL: "123456789B01", IT: "12345678901", ES: "A1234567B", IE: "1234567FA", AT: "U12345678", BE: "0123456789", PL: "1234567890", SE: "123456789012" };

export function validateUkVat(v: string): string | null {
  return /^(GB)?(\d{9}|\d{12})$/.test(normalise(v)) ? null : "UK VAT number has 9 digits (optionally prefixed GB)";
}
