// Maps Vaulte's verified KYB package to Nium's Create Customer v5 request (corporate). Field names and rules come from
// docs.nium.com (US/EU/UK/SG required parameters) and were proven on the sandbox with scripts/nium-e2e.ts.
import type { CustomerPackage, PackagePerson } from "@/lib/psp/stablecoin/partner";

/** Nium's regulatory region for a customer's country of registration (their documented table; anything else is SG). */
export function niumRegion(country: string): string {
  const c = country.toUpperCase();
  if (["GB", "CH", "MC"].includes(c)) return "UK";
  if (["US", "AU", "NZ", "CA", "HK", "JP", "ID", "MY", "SG"].includes(c)) return c;
  const EEA = "AT BE BG HR CY CZ DK EE FI FR DE GR HU IS IE IT LV LI LT LU MT NL NO PL PT RO SK SI ES SE".split(" ");
  return EEA.includes(c) ? "EU" : "SG";
}

export type EnumLists = Partial<Record<"businessType" | "monthlyTransactionVolume" | "monthlyTransactions" | "averageTransactionValue" | "intendedUseOfAccount" | "totalEmployees" | "annualTurnover" | "industrySector", { code: string; description: string }[]>>;

const BUSINESS_TYPE: Record<string, string> = {
  "private limited": "limited_liability_company", "limited liability company": "limited_liability_company", llc: "limited_liability_company", corporation: "corporation",
  "public limited": "public_company", llp: "limited_liability_partnership", partnership: "general_partnership", "sole proprietorship": "sole_trader", trust: "trust",
};
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
    businessType: BUSINESS_TYPE[(pkg.businessType ?? "").toLowerCase()] ?? "limited_liability_company",
    bankAccountDetails: { accountName: rb.accountName, accountNumber: rb.accountNumber, bankCountry: rb.bankCountry, currency: rb.currency, ...(rb.bankName ? { bankName: rb.bankName } : {}), routingCodes: [{ type: rb.routingType, value: rb.routingValue }] },
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
