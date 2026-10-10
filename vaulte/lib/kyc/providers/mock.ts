// Deterministic provider for development and tests. NEVER enabled in production (see index.ts).
import { validateGstin } from "../validators";
import type { CheckInput, CheckResult, VerificationProvider } from "./types";

export class MockProvider implements VerificationProvider {
  readonly name = "mock";
  supports(code: string, country: string) {
    return (code === "PAN" || code === "GSTIN" || code === "BANK_ACCOUNT") && country === "IN";
  }
  async verify(i: CheckInput): Promise<CheckResult> {
    const ref = `mock_${i.code.toLowerCase()}_${Date.now()}`;
    if (i.code === "PAN") {
      // Test rule: PANs starting ZZZ are "not found"; others verify and match the supplied name.
      if (i.value.startsWith("ZZZ")) return { status: "FAILED", provider: this.name, providerRef: ref, details: { status: "invalid" }, reason: "PAN not found" };
      return { status: "VERIFIED", provider: this.name, providerRef: ref, details: { status: "valid", name_match: true, dob_match: !!i.dateOfBirth } };
    }
    if (i.code === "GSTIN") {
      if (validateGstin(i.value)) return { status: "FAILED", provider: this.name, providerRef: ref, details: { valid: false }, reason: "GSTIN checksum invalid" };
      return { status: "VERIFIED", provider: this.name, providerRef: ref, details: { valid: true, status: "Active", registered_name: i.name ?? "MOCK TRADING PRIVATE LIMITED" } };
    }
    // Bank account: account numbers ending 0000 "do not exist".
    if (i.value.split("|")[1]?.endsWith("0000")) return { status: "FAILED", provider: this.name, providerRef: ref, details: { account_exists: false }, reason: "Account not found" };
    return { status: "VERIFIED", provider: this.name, providerRef: ref, details: { account_exists: true, name_at_bank: i.name ?? "MOCK ACCOUNT HOLDER" } };
  }
}
