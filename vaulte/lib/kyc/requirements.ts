// What we ask for, per region and purpose. This is a product requirement matrix built from public
// guidance (Oct 2026): it is NOT legal advice, and the licensed partners may ask for more.
import {
  validateBankAccount, validateCin, validateEin, validateGenericReg, validateGstin, validateIec, validateLei,
  validatePan, validateUkCompany,
} from "./validators";
import { bankFormat, businessPack, individualNotes } from "./countries";
import type { RegistryCode } from "./registries/types";

export type CaseKind = "KYB" | "KYC";

export const PURPOSES = {
  KYB: [
    { code: "EXPORT_SERVICES", label: "Receive payments for exported services" },
    { code: "EXPORT_GOODS", label: "Receive payments for exported goods" },
    { code: "IMPORT_GOODS", label: "Pay overseas suppliers for goods" },
    { code: "IMPORT_SERVICES", label: "Pay overseas providers for services" },
    { code: "MARKETPLACE_PAYOUTS", label: "Receive marketplace / platform payouts" },
  ],
  KYC: [
    { code: "FAMILY_MAINTENANCE", label: "Family support or gifts (sending or receiving)" },
    { code: "LRS_OUTWARD", label: "Send money abroad under the Liberalised Remittance Scheme (education, travel, gifts, investment)" },
    { code: "FREELANCE_RECEIPTS", label: "Receive freelance or professional income from abroad" },
    { code: "GIFT_OR_SUPPORT_RECEIVED", label: "Receive personal money from abroad" },
  ],
} as const;

export function validPurposes(kind: CaseKind): string[] {
  return PURPOSES[kind].map(p => p.code);
}

export interface FieldSpec {
  key: string;
  label: string;
  type: "text" | "date" | "number" | "textarea" | "select";
  required: boolean;
  options?: string[];
  help?: string;
}

export interface ItemSpec {
  code: string;
  label: string;
  help: string;
  required: boolean;
  /** A provider can check this automatically (otherwise staff review it from documents). */
  autoVerifiable: boolean;
  validate: (value: string) => string | null;
  /** Official registry that can look this identifier up (name/status/address prefill). */
  registry?: RegistryCode;
}

export interface DocSpec {
  type: string;
  label: string;
  required: boolean;
  /** Document belongs to a named person (director, UBO, signatory, applicant). */
  perPerson?: boolean;
}

export interface PersonSpec {
  role: "APPLICANT" | "UBO" | "DIRECTOR" | "SIGNATORY";
  label: string;
  min: number;
}

export interface Requirements {
  kind: CaseKind;
  country: string;
  profile: FieldSpec[];
  items: ItemSpec[];
  documents: DocSpec[];
  people: PersonSpec[];
  /** Ownership share (percent, strictly more than) at which a person must be identified as a beneficial owner. */
  uboThresholdPct: number;
  notes: string[];
}

/** Beneficial-ownership thresholds used by this product. Confirm with counsel for each market. */
export function uboThreshold(country: string): number {
  if (country === "IN") return 10; // PML Rules: companies, more than 10% (2023 amendment)
  return 25; // EU AMLD, UK PSC, US FinCEN CDD, UAE: 25%
}

export const ID_TYPES = ["PASSPORT", "NATIONAL_ID", "DRIVING_LICENCE", "VOTER_ID", "RESIDENCE_PERMIT", "MASKED_AADHAAR", "EMIRATES_ID", "IQAMA", "NRIC", "CITIZENSHIP_CERT"] as const;

export const SOURCE_OF_FUNDS = ["SALARY", "BUSINESS_INCOME", "SAVINGS", "INVESTMENTS", "PROPERTY_SALE", "GIFT", "INHERITANCE", "OTHER"];

const BUSINESS_PROFILE: FieldSpec[] = [
  { key: "legal_name", label: "Legal name", type: "text", required: true },
  { key: "business_type", label: "Entity type", type: "select", required: true, options: ["Private limited", "Public limited", "LLP", "Partnership", "Sole proprietorship", "Trust / society", "Other"] },
  { key: "industry", label: "Industry / nature of business", type: "text", required: true },
  { key: "incorporation_date", label: "Date of incorporation", type: "date", required: true },
  { key: "address", label: "Registered address", type: "textarea", required: true },
  { key: "website", label: "Website", type: "text", required: false },
  { key: "expected_monthly_usd", label: "Expected monthly volume (USD)", type: "number", required: true },
  { key: "source_of_funds", label: "Source of funds", type: "select", required: true, options: SOURCE_OF_FUNDS },
];

const INDIVIDUAL_PROFILE: FieldSpec[] = [
  { key: "occupation", label: "Occupation", type: "text", required: true },
  { key: "address", label: "Residential address", type: "textarea", required: true },
  { key: "expected_monthly_usd", label: "Expected monthly volume (USD)", type: "number", required: true },
  { key: "source_of_funds", label: "Source of funds", type: "select", required: true, options: SOURCE_OF_FUNDS },
];

export function requirementsFor(kind: CaseKind, country: string, purposes: string[]): Requirements {
  const has = (p: string) => purposes.includes(p);
  const items: ItemSpec[] = [];
  const documents: DocSpec[] = [];
  const people: PersonSpec[] = [];
  const notes: string[] = [];
  const c = country.toUpperCase();
  let entityTypes: string[] | undefined;

  if (kind === "KYB") {
    if (c === "IN") {
      items.push(
        { code: "PAN", label: "Company / firm PAN", help: "Permanent Account Number of the business", required: true, autoVerifiable: true, validate: v => validatePan(v, "BUSINESS") },
        { code: "CIN", label: "CIN or LLPIN", help: "MCA registration number (companies and LLPs)", required: true, autoVerifiable: false, validate: validateCin },
        { code: "GSTIN", label: "GSTIN", help: "Mandatory for goods trade. We fetch your registered legal name from the GST register.", required: has("EXPORT_GOODS") || has("IMPORT_GOODS"), autoVerifiable: true, validate: validateGstin, registry: "GSTIN" },
        { code: "IEC", label: "Importer-Exporter Code", help: "Required for goods exports and imports", required: has("EXPORT_GOODS") || has("IMPORT_GOODS"), autoVerifiable: false, validate: validateIec },
        { code: "BANK_ACCOUNT", label: "Business bank account (IFSC|account number)", help: "Format IFSC|account, e.g. HDFC0001234|123456789012. Used to receive INR.", required: true, autoVerifiable: true, validate: v => validateBankAccount(v, "IN") },
      );
      documents.push(
        { type: "CERT_OF_INCORPORATION", label: "Certificate of incorporation / LLP agreement", required: true },
        { type: "PAN_CARD", label: "Company PAN card", required: true },
        { type: "ADDRESS_PROOF", label: "Proof of registered address", required: true },
        { type: "BOARD_AUTHORISATION", label: "Board resolution / authority letter for the signatory", required: true },
        { type: "BANK_PROOF", label: "Cancelled cheque or recent bank statement", required: true },
        { type: "GST_CERTIFICATE", label: "GST registration certificate", required: has("EXPORT_GOODS") || has("IMPORT_GOODS") },
        { type: "IEC_CERTIFICATE", label: "IEC certificate", required: has("EXPORT_GOODS") || has("IMPORT_GOODS") },
        { type: "MOA_AOA", label: "Memorandum and articles of association", required: false },
        { type: "OWNERSHIP_STRUCTURE", label: "Ownership structure chart", required: false },
      );
      notes.push(
        "Indian payment aggregators must complete full merchant KYC (including video KYC of the authorised signatory) before settling to an Indian business; our partner will repeat this step.",
        "Do not upload Aadhaar numbers. If Aadhaar is your ID proof, upload a masked copy only.",
      );
    } else if (c === "US") {
      items.push(
        { code: "EIN", label: "EIN", help: "IRS Employer Identification Number", required: true, autoVerifiable: false, validate: validateEin },
        { code: "BANK_ACCOUNT", label: "Business bank account (routing|account number)", help: "Format 021000021|123456789", required: true, autoVerifiable: false, validate: v => validateBankAccount(v, "US") },
      );
      documents.push(
        { type: "CERT_OF_INCORPORATION", label: "Formation document (certificate of incorporation / articles of organisation)", required: true },
        { type: "TAX_FORM_W9", label: "IRS Form W-9", required: true },
        { type: "ADDRESS_PROOF", label: "Proof of business address", required: true },
        { type: "BANK_PROOF", label: "Bank statement or voided cheque", required: true },
        { type: "OWNERSHIP_STRUCTURE", label: "Ownership structure chart", required: false },
      );
      notes.push("FinCEN's CDD rule requires identifying each owner of 25% or more and one control person.");
    } else {
      const pack = businessPack(c, has);
      items.push(...pack.items);
      documents.push(...pack.documents);
      notes.push(...pack.notes);
      if (pack.entityTypes) entityTypes = pack.entityTypes;
    }
    people.push(
      { role: "UBO", label: "Beneficial owners", min: 1 },
      { role: "DIRECTOR", label: "Directors / partners", min: 1 },
      { role: "SIGNATORY", label: "Authorised signatory", min: 1 },
    );
    documents.push({ type: "ID_PROOF", label: "Government ID", required: true, perPerson: true });
    if (has("IMPORT_GOODS") || has("IMPORT_SERVICES")) documents.push({ type: "SUPPLIER_CONTRACT_SAMPLE", label: "Sample supplier contract or invoice", required: false });
    return { kind, country: c, profile: entityTypes ? BUSINESS_PROFILE.map(f => (f.key === "business_type" ? { ...f, options: entityTypes! } : f)) : BUSINESS_PROFILE, items, documents, people, uboThresholdPct: uboThreshold(c), notes };
  }

  // KYC (individual)
  if (c === "IN") {
    items.push(
      { code: "PAN", label: "PAN", help: "Required for rupee payouts and for any remittance under LRS", required: true, autoVerifiable: true, validate: v => validatePan(v, "INDIVIDUAL") },
      { code: "BANK_ACCOUNT", label: "Bank account (IFSC|account number)", help: "Format IFSC|account. The account must be in your own name.", required: has("FAMILY_MAINTENANCE") || has("FREELANCE_RECEIPTS") || has("GIFT_OR_SUPPORT_RECEIVED"), autoVerifiable: true, validate: v => validateBankAccount(v, "IN") },
    );
    notes.push(
      "Do not enter your Aadhaar number. If Aadhaar is your ID proof, upload a masked copy; biometric or e-KYC checks happen only with a licensed partner.",
      "Remittances under LRS are capped at USD 250,000 per financial year per individual and need a purpose code.",
    );
  } else {
    items.push({ code: "TAX_ID", label: "Tax identification number (if any)", help: "Do not enter government social security numbers", required: false, autoVerifiable: false, validate: validateGenericReg });
    items.push({ code: "BANK_ACCOUNT", label: `Bank account (${bankFormat(c)})`, help: "The account must be in your own name", required: false, autoVerifiable: false, validate: v => validateBankAccount(v, c) });
  }
  notes.push(...individualNotes(c));
  documents.push(
    { type: "ID_PROOF", label: "Government photo ID (passport, driving licence, national ID)", required: true, perPerson: true },
    { type: "ADDRESS_PROOF", label: "Proof of address (dated within 3 months)", required: true },
    { type: "SELFIE", label: "Selfie holding your ID (if your partner does not run video KYC)", required: false },
  );
  if (has("LRS_OUTWARD")) {
    documents.push({ type: "SOURCE_OF_FUNDS_PROOF", label: "Proof of source of funds (salary slips, ITR, bank statement)", required: true });
  }
  people.push({ role: "APPLICANT", label: "Applicant", min: 1 });
  return { kind, country: c, profile: INDIVIDUAL_PROFILE, items, documents, people, uboThresholdPct: uboThreshold(c), notes };
}

export interface CaseSnapshot {
  profile: Record<string, unknown>;
  items: { code: string; status: string }[];
  people: { role: string; ownershipPct?: number | null }[];
  documents: { type: string; personId?: string | null; status: string }[];
}

export interface MissingItem {
  section: "profile" | "item" | "document" | "person";
  key: string;
  label: string;
}

/** What still blocks submission. Failed items and rejected documents count as missing. */
export function missingForSubmission(req: Requirements, snap: CaseSnapshot): MissingItem[] {
  const out: MissingItem[] = [];
  for (const f of req.profile) {
    const v = snap.profile[f.key];
    if (f.required && (v === undefined || v === null || String(v).trim() === "")) out.push({ section: "profile", key: f.key, label: f.label });
  }
  for (const it of req.items) {
    if (!it.required) continue;
    const have = snap.items.find(i => i.code === it.code);
    if (!have || have.status === "FAILED") out.push({ section: "item", key: it.code, label: it.label });
  }
  for (const p of req.people) {
    const n = snap.people.filter(x => x.role === p.role).length;
    if (n < p.min) out.push({ section: "person", key: p.role, label: p.label });
  }
  for (const d of req.documents) {
    if (!d.required) continue;
    if (d.perPerson) {
      // At least one accepted-or-pending ID per identified person is checked at review; here one is needed per person.
      const persons = snap.people.length;
      const docs = snap.documents.filter(x => x.type === d.type && x.status !== "REJECTED" && x.personId).length;
      if (docs < Math.max(1, persons)) out.push({ section: "document", key: d.type, label: d.label });
    } else if (!snap.documents.some(x => x.type === d.type && x.status !== "REJECTED")) {
      out.push({ section: "document", key: d.type, label: d.label });
    }
  }
  // Beneficial-ownership completeness: named owners above the threshold must add up, and the shares must be plausible.
  const total = snap.people.filter(p => p.role === "UBO").reduce((s, p) => s + (p.ownershipPct ?? 0), 0);
  if (total > 100.0001) out.push({ section: "person", key: "UBO", label: "Ownership percentages add up to more than 100%" });
  return out;
}
