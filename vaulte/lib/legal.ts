// Company details for the policy pages come from configuration so nothing invented ships by accident.
const REQUIRED = "[NOT CONFIGURED]";
const env = (k: string, fallback?: string) => process.env[k] || fallback;

export const COMPANY = {
  name: env("COMPANY_LEGAL_NAME") ?? `COMPANY_LEGAL_NAME ${REQUIRED}`,
  address: env("COMPANY_ADDRESS") ?? `COMPANY_ADDRESS ${REQUIRED}`,
  /** Optional: a sole proprietorship may have no registration number to show. */
  registration: env("COMPANY_REGISTRATION", ""),
  supportEmail: env("SUPPORT_EMAIL") ?? `SUPPORT_EMAIL ${REQUIRED}`,
  privacyEmail: env("PRIVACY_EMAIL", env("SUPPORT_EMAIL")) ?? `PRIVACY_EMAIL ${REQUIRED}`,
  grievanceName: env("GRIEVANCE_OFFICER_NAME") ?? `GRIEVANCE_OFFICER_NAME ${REQUIRED}`,
  grievanceEmail: env("GRIEVANCE_OFFICER_EMAIL") ?? `GRIEVANCE_OFFICER_EMAIL ${REQUIRED}`,
  /** Optional: shown only when set. */
  grievancePhone: env("GRIEVANCE_OFFICER_PHONE", ""),
  dataRegion: env("DATA_REGION") ?? `DATA_REGION ${REQUIRED}`,
  governingLaw: env("GOVERNING_LAW", "the laws of India, with the courts at New Delhi, India having jurisdiction") as string,
  complianceOfficer: env("COMPLIANCE_OFFICER_NAME", env("GRIEVANCE_OFFICER_NAME")) ?? `COMPLIANCE_OFFICER_NAME ${REQUIRED}`,
  /** Optional: appointed representatives, shown only when set. */
  euRepresentative: env("EU_REPRESENTATIVE", ""),
  ukRepresentative: env("UK_REPRESENTATIVE", ""),
  siteUrl: env("NEXT_PUBLIC_APP_URL", "https://vaulte.iaexnetwork.com") as string,
};

/** Version and effective date of the whole legal pack. Changing TERMS_VERSION (lib/auth-flows.ts) asks every user to accept again. */
export const LEGAL_EFFECTIVE_DATE = "8 October 2026";

/** Counsel sign-off is recorded by the operator (LEGAL_REVIEWED=true) and shown as a line on each page; the texts themselves are complete either way. */
export const LEGAL_REVIEWED = process.env.LEGAL_REVIEWED === "true";

export const REGIONS = [
  { slug: "india", name: "India", law: "Digital Personal Data Protection Act, 2023 and Rules, 2025" },
  { slug: "united-states", name: "United States", law: "State privacy laws including the California Consumer Privacy Act" },
  { slug: "uae", name: "United Arab Emirates", law: "Federal Decree-Law No. 45 of 2021 (PDPL), DIFC and ADGM data protection laws" },
  { slug: "singapore", name: "Singapore", law: "Personal Data Protection Act 2012" },
  { slug: "eu-uk", name: "European Union and United Kingdom", law: "GDPR and UK GDPR" },
] as const;
export type RegionSlug = (typeof REGIONS)[number]["slug"];

export const unconfiguredFields = () => Object.entries(COMPANY).filter(([, v]) => typeof v === "string" && v.includes(REQUIRED)).map(([k]) => k);
