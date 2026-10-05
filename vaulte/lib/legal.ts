// Company details for the policy pages come from configuration so nothing invented ships by accident.
export const COMPANY = {
  name: process.env.COMPANY_LEGAL_NAME || "[COMPANY LEGAL NAME - NOT CONFIGURED]",
  address: process.env.COMPANY_ADDRESS || "[REGISTERED ADDRESS - NOT CONFIGURED]",
  registration: process.env.COMPANY_REGISTRATION || "[REGISTRATION NUMBER - NOT CONFIGURED]",
  supportEmail: process.env.SUPPORT_EMAIL || "[SUPPORT EMAIL - NOT CONFIGURED]",
  privacyEmail: process.env.PRIVACY_EMAIL || process.env.SUPPORT_EMAIL || "[PRIVACY EMAIL - NOT CONFIGURED]",
  grievanceName: process.env.GRIEVANCE_OFFICER_NAME || "[GRIEVANCE OFFICER NAME - NOT CONFIGURED]",
  grievanceEmail: process.env.GRIEVANCE_OFFICER_EMAIL || "[GRIEVANCE OFFICER EMAIL - NOT CONFIGURED]",
  grievancePhone: process.env.GRIEVANCE_OFFICER_PHONE || "[PHONE - NOT CONFIGURED]",
  dataRegion: process.env.DATA_REGION || "[DATA HOSTING REGION - NOT CONFIGURED]",
  governingLaw: process.env.GOVERNING_LAW || "[GOVERNING LAW AND COURTS - NOT CONFIGURED]",
};

/** True once counsel has approved the texts and the operator has set LEGAL_REVIEWED=true. */
export const LEGAL_REVIEWED = process.env.LEGAL_REVIEWED === "true";

export const unconfiguredFields = () => Object.entries(COMPANY).filter(([, v]) => v.includes("NOT CONFIGURED")).map(([k]) => k);
