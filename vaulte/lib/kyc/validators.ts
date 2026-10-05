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

/** Bank account value formats: India "IFSC|account", US "ABA|account", elsewhere an IBAN. */
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
  return validateIban(raw);
}

/** Keeps the last 4 characters; the rest is starred. */
export function mask(v: string): string {
  const s = v.replace(/\s+/g, "");
  if (s.length <= 4) return "*".repeat(s.length);
  return "*".repeat(Math.min(s.length - 4, 12)) + s.slice(-4);
}
