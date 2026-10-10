// Test corporate package for the Nium sandbox scripts (sandbox only; the sandbox refuses a duplicate registration number, so it is derived from the clock).
import type { CustomerPackage } from "../lib/psp/stablecoin/partner";

export const niumTestPackage = (t: string): CustomerPackage => ({
  organizationId: `e2e${t}`, legalName: `Vaulte E2E ${t} LLC`, country: "US", registrationNumber: String(100000000 + (Date.now() % 800000000)), taxId: null, businessType: "Private limited", riskTier: "MEDIUM", kybApprovedAt: new Date().toISOString(),
  address: "1 Main St", city: "Austin", state: "TX", postalCode: "73301", incorporationDate: "2019-05-21", industry: "Software", website: "https://example.com", expectedMonthlyUsd: 40_000,
  people: [{ role: "APPLICANT", firstName: "Test", lastName: "Owner", dateOfBirth: "1985-03-14", nationality: "US", ownershipPct: 100, email: "owner@example.com", phone: "7337223608", phoneCountryCode: "1", address: { line1: "1 Main St", city: "Austin", state: "TX", postcode: "73301", country: "US" } }],
  returnBank: { accountName: `Vaulte E2E ${t} LLC`, accountNumber: "AT483200000012345", bankCountry: "US", currency: "USD", routingType: "ACH CODE", routingValue: "042100175", bankName: "Test Bank" },
  consent: { acceptedAt: new Date().toISOString(), ip: "203.0.113.10", deviceInfo: "web", sessionId: `e2e-${t}` },
  documents: [{ type: "business_registration_doc", fileIds: ["787244f3-b4f9-4c54-02af-b472123a6067"] }],
} as CustomerPackage);
