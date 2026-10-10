// Maps Vaulte's verified KYB package to Nium's Create Customer v5 request (corporate). Field names and rules come from
// docs.nium.com (US/EU/UK/SG required parameters) and were proven on the sandbox with scripts/nium-e2e.ts.
import type { CustomerPackage, InfoAnswer, InfoRequest, PackagePerson } from "@/lib/psp/stablecoin/partner";
import type { NiumRfiTemplate } from "./client";

/** Nium's regulatory region for a customer's country of registration (their documented table; anything else is SG). */
export function niumRegion(country: string): string {
  const c = country.toUpperCase();
  if (["GB", "CH", "MC"].includes(c)) return "UK";
  if (["US", "AU", "NZ", "CA", "HK", "JP", "ID", "MY", "SG"].includes(c)) return c;
  const EEA = "AT BE BG HR CY CZ DK EE FI FR DE GR HU IS IE IT LV LI LT LU MT NL NO PL PT RO SK SI ES SE".split(" ");
  return EEA.includes(c) ? "EU" : "SG";
}

export type EnumLists = Partial<Record<"businessType" | "monthlyTransactionVolume" | "monthlyTransactions" | "averageTransactionValue" | "intendedUseOfAccount" | "totalEmployees" | "annualTurnover" | "industrySector", { code: string; description: string }[]>>;

/** How we describe the legal form -> Nium's codes in order of preference; the first one the region offers is used (the lists differ: SG has PRIVATE_COMPANY, the US has LIMITED_LIABILITY_COMPANY). */
const FORM_PREFERENCE: [RegExp, string[]][] = [
  [/public/i, ["PUBLIC_COMPANY"]], [/\bllp\b|limited liability partnership/i, ["LIMITED_LIABILITY_PARTNERSHIP"]],
  [/\bllc\b|limited liability company/i, ["LIMITED_LIABILITY_COMPANY", "PRIVATE_COMPANY", "CORPORATION"]], [/corporation|\binc\b/i, ["CORPORATION", "PRIVATE_COMPANY", "PUBLIC_COMPANY"]],
  [/partnership|firm/i, ["GENERAL_PARTNERSHIP", "PARTNERSHIP", "UNINCORP_PARTNERSHIP"]], [/sole|proprietor/i, ["SOLE_TRADER"]], [/trust/i, ["TRUST"]],
];
export function niumBusinessType(form: string | null | undefined, offered: { code: string }[] | undefined): string {
  const prefer = FORM_PREFERENCE.find(([re]) => re.test(form ?? ""))?.[1] ?? ["PRIVATE_COMPANY", "LIMITED_LIABILITY_COMPANY", "CORPORATION", "OTHERS"];
  const have = new Set((offered ?? []).map(o => o.code.toUpperCase()));
  const pick = prefer.find(c => have.has(c)) ?? (have.has("OTHERS") ? "OTHERS" : prefer[0]);
  return pick.toLowerCase();
}
const VOLUME_STEPS = [5_000, 10_000, 20_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 10_000_000];

/** Picks from Nium's ordered (ascending) list by where the value falls among the given thresholds. */
function byThreshold(list: { code: string }[] | undefined, value: number, steps = VOLUME_STEPS): string | undefined {
  if (!list?.length) return undefined;
  const idx = Math.min(steps.filter(s => value > s).length, list.length - 1);
  return list[idx].code;
}
const first = (list?: { code: string }[]) => list?.[0]?.code;
const pick = (list: { code: string; description: string }[] | undefined, re: RegExp) => list?.find(x => re.test(x.description))?.code ?? list?.[0]?.code;

const POSITION: Record<PackagePerson["role"], string[]> = { APPLICANT: ["control_prong"], UBO: ["ubo"], DIRECTOR: ["director"], SIGNATORY: ["signatory"] };

const addr = (a: NonNullable<PackagePerson["address"]>, country: string) => ({ addressLine1: a.line1, ...(a.line2 ? { addressLine2: a.line2 } : {}), city: a.city, state: a.state && a.state.includes("-") ? a.state : `${a.country.toUpperCase()}-${(a.state ?? "").toUpperCase()}`, postcode: a.postcode, country: (a.country || country).toUpperCase() });

/** Whether a person lives in the regulatory region (Nium's SG region serves everyone outside the US, UK and EU, so only Singapore residents count there). */
export const isResidentOf = (region: string, countryCode: string) => niumRegion(countryCode) === region && (region !== "SG" || countryCode.toUpperCase() === "SG");

export interface NiumPayloadResult { body?: Record<string, unknown>; missing: string[] }

export function niumCorporatePayload(pkg: CustomerPackage, enums: EnumLists, now = new Date()): NiumPayloadResult {
  const missing: string[] = [];
  const need = <T>(v: T | null | undefined | "", label: string): T => { if (!v) missing.push(label); return v as T; };
  const country = pkg.country.toUpperCase();
  const people = pkg.people ?? [];
  const applicant = people.find(p => p.role === "APPLICANT") ?? people.find(p => p.role === "SIGNATORY");
  if (!applicant) missing.push("an applicant (the person applying for the business)");
  const regNo = pkg.registrationNumber ?? pkg.taxId;
  need(regNo, "registration number"); need(pkg.incorporationDate, "incorporation date"); need(pkg.address, "registered address"); need(pkg.city, "city"); need(pkg.postalCode, "postcode");
  need(pkg.returnBank, "a bank account for returns and refunds");
  const usd = pkg.expectedMonthlyUsd ?? 10_000;
  const a = applicant;
  if (a) { need(a.dateOfBirth, "applicant date of birth"); need(a.nationality, "applicant nationality"); need(a.email, "applicant email"); need(a.phone, "applicant phone"); need(a.address, "applicant address"); }
  if (missing.length) return { missing };

  const ts = (pkg.consent?.acceptedAt ? new Date(pkg.consent.acceptedAt) : now);
  const stamp = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
  const rb = pkg.returnBank!;
  const person = (p: PackagePerson, ref: string, withShare: boolean) => ({
    externalId: ref, firstName: p.firstName, lastName: p.lastName, dateOfBirth: p.dateOfBirth, nationality: p.nationality,
    ...(p.email ? { email: p.email } : {}), ...(p.phone ? { mobile: p.phone, mobileCountryCode: p.phoneCountryCode ?? "1" } : {}),
    ...(withShare && p.ownershipPct != null ? { sharePercentage: p.ownershipPct } : {}),
    address: p.address ? addr(p.address, country) : undefined,
    positions: Array.from(new Set(POSITION[p.role])).map(title => ({ title, startDate: pkg.incorporationDate!.slice(0, 10) })),
  });
  const others = people.filter(p => p !== a && (p.role === "UBO" || p.role === "DIRECTOR") && p.address && p.dateOfBirth && p.nationality);
  const volume = byThreshold(enums.monthlyTransactionVolume, usd);
  const body: Record<string, unknown> = {
    type: "corporate", kycType: "full", region: niumRegion(country), externalId: `vlt${pkg.organizationId}`.replace(/[^A-Za-z0-9]/g, "").slice(0, 36),
    businessName: pkg.legalName.slice(0, 80), tradeName: pkg.legalName.slice(0, 80), businessRegistrationNumber: regNo, registeredDate: pkg.incorporationDate!.slice(0, 10), registeredCountry: country,
    ...(pkg.website ? { website: pkg.website } : {}), isMultiLayeredCompany: false,
    businessType: niumBusinessType(pkg.businessType, enums.businessType),
    bankAccountDetails: { accountName: rb.accountName, accountNumber: rb.accountNumber, bankCountry: rb.bankCountry, currency: rb.currency, bankName: rb.bankName || `${rb.bankCountry} bank`, ...(rb.routingType ? { routingCodes: [{ type: rb.routingType, value: rb.routingValue }] } : {}) },
    applicantDeclaration: true, applicantDeclarationTimeStamp: stamp(ts > now ? now : ts),
    addresses: { isBusinessAddressSameAsRegisteredAddress: true, registeredAddress: { addressLine1: pkg.address, city: pkg.city, state: `${country}-${(pkg.state ?? "").toUpperCase()}`.replace(/-$/, ""), postcode: pkg.postalCode, country } },
    applicant: { ...person(a!, "applicant1", true), positions: [{ title: "control_prong", startDate: pkg.incorporationDate!.slice(0, 10) }, ...(a!.ownershipPct ? [{ title: "ubo", startDate: pkg.incorporationDate!.slice(0, 10) }] : [])] },
    ...(others.length ? { stakeholders: { individual: others.map((p, i) => person(p, `stakeholder${i + 1}`, true)) } } : {}),
    natureOfBusiness: { operatingCountries: Array.from(new Set([country, "IN"])), industryCodes: [pick(enums.industrySector, new RegExp((pkg.industry ?? "").split(/\W+/)[0] || "^$", "i"))].filter(Boolean), industryDescription: `${pkg.industry ?? "Business services"}: cross-border business payments with customers and suppliers`.slice(0, 1000) },
    expectedAccountUsage: {
      intendedUses: [pick(enums.intendedUseOfAccount, /receive payments for goods or services/i)].filter(Boolean),
      intendedUsesDescription: "Receiving and sending cross-border business payments",
      credit: { monthlyTransactionVolume: volume, monthlyTransactions: first(enums.monthlyTransactions), averageTransactionValue: first(enums.averageTransactionValue), topTransactionCountries: [country] },
      debit: { monthlyTransactionVolume: volume, monthlyTransactions: first(enums.monthlyTransactions), averageTransactionValue: first(enums.averageTransactionValue), topTransactionCountries: ["IN"] },
    },
    sizeOfBusiness: { totalEmployees: first(enums.totalEmployees), annualTurnover: byThreshold(enums.annualTurnover, usd * 12, [100_000, 500_000, 1_500_000]) },
    deviceDetails: { ipCountryCode: country.toLowerCase(), deviceInfo: pkg.consent?.deviceInfo ?? "web", ipAddress: pkg.consent?.ip ?? "203.0.113.10", sessionId: pkg.consent?.sessionId ?? `vlt-${pkg.organizationId}`.slice(0, 40) },
    tags: [{ key: "vaulteOrganizationId", value: pkg.organizationId }],
    ...(pkg.documents?.length ? { documents: pkg.documents.map(d => ({ type: d.type, fileIds: d.fileIds })) } : {}),
  };
  return { body, missing };
}

/** Titles for Nium's RFI template names. */
const RFI_TITLES: Record<string, string> = {
  applicantIdentity: "Applicant's identity document", applicantAddress: "Applicant's proof of address", applicantAuthorizationLetter: "Letter of authorization", powerOfAttorney: "Power of attorney",
  stakeholderIdentity: "Owner or director's identity document", stakeholderAddress: "Owner or director's proof of address",
  businessName: "Registered business name", otherData: "More information", businessRegistrationDocument: "Business registration document", corporateAddressProof: "Business address proof",
  directorsRegister: "Register of directors", shareholdersRegister: "Register of shareholders", partnershipDeed: "Partnership deed", trustDeed: "Trust deed", license: "Business licence", invoice: "Invoice", otherDocument: "Supporting document",
  transactionCountries: "Countries you will transact with", intendedUseOfAccount: "What the account is used for",
};
export const niumRfiTitle = (name: string) => RFI_TITLES[name] ?? name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());

const FIELD_KIND = (f: { fieldValue: string; type: string }): "text" | "date" | "file" => (f.type === "document" ? "file" : /date/i.test(f.fieldValue) ? "date" : "text");

/** One Nium RFI template as a form the customer can fill in inside Vaulte. */
export function niumInfoRequest(t: NiumRfiTemplate): InfoRequest {
  const url = /https?:\/\/\S+/.exec(t.remarks ?? "")?.[0];
  return { id: t.rfiHashId, title: niumRfiTitle(t.template.name), remarks: t.remarks || undefined, ...(url ? { url } : {}), status: t.status === "RFI_REQUESTED" ? "OPEN" : "ANSWERED", fields: t.template.requiredFields.map(f => ({ key: f.fieldValue, label: f.fieldLabel, kind: FIELD_KIND(f) })) };
}

/** Nium's "Respond to RFI" request item for a template: the same shape as the onboarding request, with only the asked-for fields. Throws when something asked for is missing. */
export function niumRfiResponseItem(t: NiumRfiTemplate, a: InfoAnswer): Record<string, unknown> {
  const missing = t.template.requiredFields.filter(f => (f.type === "document" ? !a.files[f.fieldValue]?.dataBase64 : !a.values[f.fieldValue]?.trim())).map(f => f.fieldLabel);
  if (missing.length) throw new Error(`INFO_REQUEST_INCOMPLETE: ${missing.join(", ")}`);
  const v = (k: string) => a.values[k]?.trim();
  const file = a.files.document;
  const documentDetails = { ...(v("documentType") ? { documentType: v("documentType") } : {}), ...(v("documentNumber") ? { documentNumber: v("documentNumber") } : {}), ...(v("documentExpiryDate") ? { documentExpiryDate: v("documentExpiryDate") } : {}), ...(file ? { document: [{ document: file.dataBase64, fileName: file.name, fileType: file.mime }] } : {}) };
  const rfiHashId = t.rfiHashId, { name, rfiType } = t.template;
  if (rfiType === "applicant") return { rfiHashId, businessDetails: { applicantDetails: { referenceId: t.referenceId, documentDetails } } };
  if (rfiType === "stakeholder") return { rfiHashId, businessDetails: { stakeholders: [{ referenceId: t.referenceId, stakeholderDetails: { documentDetails } }] } };
  if (t.template.type === "document") return { rfiHashId, businessDetails: { documentDetails } };
  if (name === "businessName") return { rfiHashId, businessDetails: { businessName: v("businessName") } };
  if (name === "otherData") return { rfiHashId, businessDetails: { additionalInfo: { otherData: v("otherData") } } };
  if (name === "transactionCountries" || name === "transacationCountries") return { rfiHashId, riskAssessmentInfo: { transactionCountries: (v("transactionCountries") ?? "").split(/[\s,;]+/).filter(Boolean).map(c => c.toUpperCase()) } };
  if (name === "intendedUseOfAccount") return { rfiHashId, riskAssessmentInfo: { intendedUseOfAccount: v("intendedUseOfAccount") } };
  throw new Error(`INFO_REQUEST_UNSUPPORTED: ${name} cannot be answered here; Vaulte support will collect it with you`);
}
