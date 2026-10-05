// Country packs: what each market's law/registry expects us to collect, and where the official source lives.
// This is a product requirement matrix from public guidance (Oct 2026), NOT legal advice; partners may ask for more.
import type { DocSpec, ItemSpec } from "./requirements";
import {
  euVatNumber, isEuCountry, validateAbn, validateAcn, validateBankAccount, validateEuVat, validateGenericReg, validateLei,
  validateMyBrn, validateNepalPan, validateSaCr, validateSaVat, validateTradeLicence, validateUaeTrn, validateUkCompany, validateUkVat,
} from "./validators";
import { registrySupports, type RegistryCode } from "./registries";

export interface RegistryInfo { name: string; url: string; /** How we use it. */ mode: "AUTO" | "KEYED" | "MANUAL" }

/** Where a human (or staff) can confirm an identifier when no API is wired. */
export const OFFICIAL_REGISTRIES: Record<string, RegistryInfo> = {
  IN: { name: "MCA21 company master data / GST portal taxpayer search", url: "https://www.mca.gov.in/", mode: "AUTO" },
  NP: { name: "Office of the Company Registrar (OCR) and Inland Revenue Department PAN search", url: "https://ocr.gov.np/", mode: "MANUAL" },
  US: { name: "State Secretary of State business search / IRS EIN confirmation (CP-575)", url: "https://www.irs.gov/businesses/small-businesses-self-employed/employer-id-numbers", mode: "MANUAL" },
  GB: { name: "Companies House", url: "https://find-and-update.company-information.service.gov.uk/", mode: "KEYED" },
  AU: { name: "ABN Lookup (Australian Business Register) / ASIC", url: "https://abr.business.gov.au/", mode: "KEYED" },
  AE: { name: "Emirate licensing authority (DED / free-zone authority) and FTA TRN checker", url: "https://tax.gov.ae/", mode: "MANUAL" },
  SA: { name: "Ministry of Commerce commercial registration (Wathq) and ZATCA VAT", url: "https://mc.gov.sa/", mode: "MANUAL" },
  MY: { name: "SSM (Companies Commission of Malaysia) business search", url: "https://www.ssm.com.my/", mode: "MANUAL" },
};
const EU_REGISTRY: RegistryInfo = { name: "EU VIES for VAT numbers; national business register via the e-Justice portal", url: "https://e-justice.europa.eu/489/EN/business_registers__search_for_a_company_in_the_eu", mode: "AUTO" };
export function registryInfo(country: string): RegistryInfo | null {
  return isEuCountry(country) ? EU_REGISTRY : OFFICIAL_REGISTRIES[country] ?? null;
}

type Has = (purpose: string) => boolean;
const item = (code: string, label: string, help: string, required: boolean, validate: (v: string) => string | null, registry?: RegistryCode, country?: string): ItemSpec => ({
  code, label, help, required, validate, autoVerifiable: registry && country ? registrySupports(registry, country) : false, ...(registry ? { registry } : {}),
});

export interface BusinessPack { items: ItemSpec[]; documents: DocSpec[]; notes: string[]; entityTypes?: string[] }

const BANK_DOC: DocSpec = { type: "BANK_PROOF", label: "Bank statement or letter showing the account holder name", required: true };
const ADDR_DOC: DocSpec = { type: "ADDRESS_PROOF", label: "Proof of business address", required: true };
const OWN_DOC: DocSpec = { type: "OWNERSHIP_STRUCTURE", label: "Ownership structure chart", required: false };

function bankItem(c: string, required = true): ItemSpec {
  const fmt = c === "AU" ? "BSB|account, e.g. 062000|12345678" : ["MY", "NP"].includes(c) ? "BIC|account, e.g. MBBEMYKL|514012345678" : "IBAN";
  return item("BANK_ACCOUNT", `Business bank account (${fmt.split(",")[0]})`, `Format: ${fmt}. The account must be in the business's own name.`, required, v => validateBankAccount(v, c));
}

export function businessPack(c: string, has: Has): BusinessPack {
  const goods = has("EXPORT_GOODS") || has("IMPORT_GOODS");
  if (c === "GB") return {
    items: [
      item("REG_NO", "Companies House number", "8 characters, e.g. 01234567 or SC123456", true, validateUkCompany, "REG_NO", c),
      item("TAX_ID", "VAT registration number", "If VAT-registered", goods, validateUkVat),
      item("LEI", "LEI (if you have one)", "Legal Entity Identifier", false, validateLei, "LEI", c),
      bankItem(c),
    ],
    documents: [{ type: "REGISTRY_EXTRACT", label: "Companies House extract (dated within 3 months)", required: true }, ADDR_DOC, BANK_DOC, OWN_DOC],
    notes: ["People with significant control (PSC, 25%+) must be listed; they appear on your Companies House record."],
    entityTypes: ["Private limited (Ltd)", "Public limited (PLC)", "LLP", "Partnership", "Sole trader", "Charity / CIC", "Other"],
  };
  if (isEuCountry(c)) return {
    items: [
      item("REG_NO", "Company registration number", "As on your national business-register extract", true, validateGenericReg),
      item("VAT_ID", "VAT ID", "Checked live against the EU VIES service", goods, validateEuVat(c), "VAT_ID", c),
      item("LEI", "LEI (if you have one)", "Legal Entity Identifier", false, validateLei, "LEI", c),
      bankItem(c),
    ],
    documents: [{ type: "REGISTRY_EXTRACT", label: "Commercial register extract (dated within 3 months)", required: true }, ADDR_DOC, BANK_DOC, OWN_DOC,
      { type: "TRANSPARENCY_REGISTER", label: "Beneficial-ownership / transparency register extract (where your country issues one)", required: false }],
    notes: ["Beneficial owners holding 25% or more (or controlling the company) must be identified under the EU AML directives."],
    entityTypes: ["GmbH / SARL / BV / S.L. / S.r.l. (limited company)", "AG / SA / NV / S.p.A. (public company)", "Partnership (OHG/KG/SNC)", "Sole trader / freelancer", "Association / foundation", "Other"],
  };
  if (c === "AU") return {
    items: [
      item("ABN", "ABN", "11 digits; checked against ABN Lookup when configured", true, validateAbn, "ABN", c),
      item("ACN", "ACN (companies)", "9 digits", false, validateAcn),
      item("LEI", "LEI (if you have one)", "Legal Entity Identifier", false, validateLei, "LEI", c),
      bankItem(c),
    ],
    documents: [{ type: "REGISTRY_EXTRACT", label: "ASIC company extract or ABN registration details", required: true }, ADDR_DOC, BANK_DOC, OWN_DOC],
    notes: ["Beneficial owners of 25% or more must be identified under the AML/CTF Act (AUSTRAC)."],
    entityTypes: ["Proprietary limited (Pty Ltd)", "Public company", "Partnership", "Sole trader", "Trust", "Other"],
  };
  if (c === "AE") return {
    items: [
      item("TRADE_LICENCE", "Trade licence number", "From your licensing authority (mainland DED/economic department or free-zone authority)", true, validateTradeLicence),
      item("TAX_ID", "Tax registration number (TRN)", "15 digits, if VAT-registered", false, validateUaeTrn),
      item("LEI", "LEI (if you have one)", "Legal Entity Identifier", false, validateLei, "LEI", c),
      bankItem(c),
    ],
    documents: [
      { type: "TRADE_LICENCE_COPY", label: "Valid trade licence", required: true }, { type: "CERT_OF_INCORPORATION", label: "Memorandum / articles of association", required: true },
      { type: "ADDRESS_PROOF", label: "Ejari / tenancy contract or utility bill for the registered office", required: true }, BANK_DOC, OWN_DOC,
    ],
    notes: ["UAE companies must keep a beneficial-ownership register (owners of 25% or more); we will ask for the same list.", "Free-zone and mainland licences differ; upload the licence that covers the activity you will transact for."],
    entityTypes: ["Mainland LLC", "Free-zone company (FZE / FZ-LLC / FZCO)", "Branch of a foreign company", "Sole establishment", "Other"],
  };
  if (c === "SA") return {
    items: [
      item("CR_NO", "Commercial Registration (CR) number", "10 digits, Ministry of Commerce", true, validateSaCr),
      item("TAX_ID", "VAT number (ZATCA)", "15 digits starting and ending with 3, if VAT-registered", false, validateSaVat),
      item("LEI", "LEI (if you have one)", "Legal Entity Identifier", false, validateLei, "LEI", c),
      bankItem(c),
    ],
    documents: [
      { type: "REGISTRY_EXTRACT", label: "Commercial registration certificate", required: true }, { type: "CERT_OF_INCORPORATION", label: "Articles of association", required: false },
      { type: "ADDRESS_PROOF", label: "Saudi National Address registration for the business", required: true }, BANK_DOC, OWN_DOC,
    ],
    notes: ["Saudi businesses are expected to hold a National Address; we ask for proof of it."],
    entityTypes: ["LLC", "Joint stock company", "Sole proprietorship", "Branch of a foreign company", "Professional company", "Other"],
  };
  if (c === "MY") return {
    items: [
      item("REG_NO", "SSM registration number", "12 digits (e.g. 201901234567) or the older 123456-X form", true, validateMyBrn),
      item("TAX_ID", "Tax identification number (TIN) / SST number", "If registered", false, validateGenericReg),
      item("LEI", "LEI (if you have one)", "Legal Entity Identifier", false, validateLei, "LEI", c),
      bankItem(c),
    ],
    documents: [
      { type: "REGISTRY_EXTRACT", label: "SSM business profile / company search (dated within 3 months)", required: true }, { type: "CERT_OF_INCORPORATION", label: "Certificate of incorporation (Form 9) or business registration certificate", required: true },
      ADDR_DOC, BANK_DOC, OWN_DOC,
    ],
    notes: ["Beneficial ownership must be reported to SSM (Form 78/ BO register); we will ask for the same information."],
    entityTypes: ["Private limited (Sdn Bhd)", "Public limited (Bhd)", "LLP", "Sole proprietorship / partnership", "Other"],
  };
  if (c === "NP") return {
    items: [
      item("TAX_ID", "PAN / VAT number (Inland Revenue Department)", "9 digits", true, validateNepalPan),
      item("REG_NO", "Company registration number (OCR)", "As on your Office of the Company Registrar certificate", true, validateGenericReg),
      bankItem(c),
    ],
    documents: [
      { type: "CERT_OF_INCORPORATION", label: "Company registration certificate (OCR)", required: true }, { type: "PAN_CARD", label: "PAN / VAT registration certificate", required: true },
      ADDR_DOC, BANK_DOC, OWN_DOC,
    ],
    notes: ["Nepal Rastra Bank (FEMA 2019) tightly controls cross-border payments; many corridors are receive-only through licensed channels. We will tell you at quote time if a corridor is not available."],
    entityTypes: ["Private limited", "Public limited", "Partnership", "Sole proprietorship", "NGO / trust", "Other"],
  };
  return {
    items: [
      item("REG_NO", "Company registration number", "As shown on the commercial registry extract", true, validateGenericReg),
      item("TAX_ID", "Tax / VAT number", "VAT or national tax identifier", false, validateGenericReg),
      item("LEI", "LEI (if you have one)", "Legal Entity Identifier", false, validateLei, "LEI", c),
      bankItem(c),
    ],
    documents: [{ type: "REGISTRY_EXTRACT", label: "Commercial registry extract (dated within 3 months)", required: true }, ADDR_DOC, BANK_DOC, OWN_DOC],
    notes: [],
  };
}

export { euVatNumber };

/** Human-readable bank-account format for a country (matches validateBankAccount). */
export function bankFormat(c: string): string {
  if (c === "IN") return "IFSC|account number";
  if (c === "US") return "routing|account number";
  if (c === "AU") return "BSB|account number";
  if (["MY", "NP"].includes(c)) return "BIC|account number";
  return "IBAN";
}

/** Notes for individuals (documents, not ID numbers: we avoid collecting national ID numbers). */
export function individualNotes(c: string): string[] {
  if (isEuCountry(c)) return ["Accepted ID: passport or national identity card. Upload both sides of a card."];
  switch (c) {
    case "AE": return ["Accepted ID: Emirates ID (front and back) or passport with residence visa."];
    case "SA": return ["Accepted ID: Saudi national ID, Iqama (residents) or passport."];
    case "MY": return ["Accepted ID: MyKad (NRIC), MyPR or passport."];
    case "NP": return ["Accepted ID: citizenship certificate, national ID or passport. Nepal Rastra Bank rules limit outward payments by individuals; see the corridor notes at quote time."];
    case "AU": return ["Accepted ID: passport or driver licence plus a second document such as a Medicare card or utility bill."];
    case "GB": return ["Accepted ID: passport or UK photocard driving licence."];
    case "US": return ["Accepted ID: passport or state driving licence. Do not enter your Social Security number."];
    default: return [];
  }
}

/** ID document types that make sense for a country (the API accepts any known type; this just keeps the form short). */
export function idTypesFor(c: string): string[] {
  if (c === "IN") return ["PASSPORT", "VOTER_ID", "DRIVING_LICENCE", "MASKED_AADHAAR"];
  if (c === "AE") return ["EMIRATES_ID", "PASSPORT", "RESIDENCE_PERMIT"];
  if (c === "SA") return ["NATIONAL_ID", "IQAMA", "PASSPORT"];
  if (c === "MY") return ["NRIC", "PASSPORT", "RESIDENCE_PERMIT"];
  if (c === "NP") return ["CITIZENSHIP_CERT", "NATIONAL_ID", "PASSPORT", "DRIVING_LICENCE"];
  if (isEuCountry(c)) return ["NATIONAL_ID", "PASSPORT", "RESIDENCE_PERMIT", "DRIVING_LICENCE"];
  if (["AU", "GB", "US"].includes(c)) return ["PASSPORT", "DRIVING_LICENCE", "RESIDENCE_PERMIT"];
  return ["PASSPORT", "NATIONAL_ID", "DRIVING_LICENCE", "RESIDENCE_PERMIT"];
}
