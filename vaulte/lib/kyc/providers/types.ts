// Verification providers check identifiers against official sources. Implementations never log full identifiers.
export type CheckCode = "PAN" | "GSTIN" | "BANK_ACCOUNT";

export interface CheckInput {
  code: CheckCode;
  /** Normalised identifier. BANK_ACCOUNT is "IFSC|account" (India only). */
  value: string;
  country: string;
  /** Name to match against the official record (person or business). */
  name?: string;
  /** DD/MM/YYYY */
  dateOfBirth?: string;
  holder: "INDIVIDUAL" | "BUSINESS";
}

export interface CheckResult {
  /** UNAVAILABLE = provider could not answer; the item falls back to manual review. */
  status: "VERIFIED" | "FAILED" | "UNAVAILABLE";
  provider: string;
  providerRef?: string;
  /** Non-sensitive facts shown to staff (match flags, registered name, status). */
  details: Record<string, unknown>;
  reason?: string;
}

export interface VerificationProvider {
  readonly name: string;
  supports(code: CheckCode, country: string): boolean;
  verify(input: CheckInput): Promise<CheckResult>;
}
