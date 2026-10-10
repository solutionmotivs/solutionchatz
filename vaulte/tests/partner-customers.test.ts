import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; organizationId: string; partner: string; sandbox: boolean; status: string; partnerRef: string | null; note: string | null };
const rows: Row[] = [];
let n = 0;
vi.mock("../lib/db", () => ({
  db: {
    organization: { findUniqueOrThrow: async () => ({ id: "org1", name: "Acme", legalName: "Acme LLC", country: "US", registrationNumber: "R1", taxId: "T1", businessType: "LLC", riskTier: "LOW", kybApprovedAt: new Date() }) },
    verificationCase: { findFirst: async () => ({ profile: { address: "1 Main St, Austin", industry: "Software", expected_monthly_usd: 5000 } }) },
    user: { findFirst: async () => ({ name: "Ada Lovelace", email: "ada@acme.example", phone: null }) },
    partnerCustomer: {
      findUnique: async ({ where: { organizationId_partner_sandbox: k } }: any) => rows.find(r => r.organizationId === k.organizationId && r.partner === k.partner && r.sandbox === k.sandbox) ?? null,
      findMany: async ({ where }: any) => rows.filter(r => r.organizationId === where.organizationId && r.sandbox === where.sandbox && where.partner.in.includes(r.partner)),
      create: async ({ data }: any) => { const r = { id: `pc${++n}`, status: "INVITED", partnerRef: null, note: null, ...data }; rows.push(r); return r; },
      update: async ({ where: { id }, data }: any) => { const r = rows.find(x => x.id === id)!; Object.assign(r, data); return r; },
    },
  },
}));
const submit = vi.fn();
vi.mock("../lib/psp/stablecoin/registry", () => ({
  getPartner: (id: string) => id === "manual_partner" ? { id } : { id, submitCustomer: submit },
}));

import { onboardingFor, requireApprovedPartners, returnBankFrom, submitToPartner } from "../lib/partners/customers";
import type { Route } from "../lib/stablecoin/types";

const route = (...partners: string[]) => ({ legs: partners.map(p => ({ partner: p })) }) as unknown as Route;
beforeEach(() => { rows.length = 0; submit.mockReset(); });

describe("delegated partner onboarding", () => {
  it("test mode never blocks, and records the sandbox partner's approval", async () => {
    submit.mockResolvedValue({ partnerRef: "mock_cust_1", status: "APPROVED" });
    await requireApprovedPartners("org1", route("mock_us", "mock_uae"), true);
    expect(rows.map(r => r.status)).toEqual(["APPROVED", "APPROVED"]);
    expect((await onboardingFor("org1", route("mock_us"), true))[0]).toMatchObject({ partner: "mock_us", status: "APPROVED" });
  });
  it("live money waits for the partner's approval and the error names the partner", async () => {
    submit.mockResolvedValue({ partnerRef: "p-1", status: "SUBMITTED" });
    await expect(requireApprovedPartners("org1", route("airwallex"), false)).rejects.toMatchObject({ code: "PARTNER_ONBOARDING_PENDING" });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({ partner: "airwallex", sandbox: false, status: "SUBMITTED", partnerRef: "p-1" });
  });
  it("the package carries the approved KYB profile and the account owner as contact", async () => {
    submit.mockResolvedValue({ partnerRef: "p-2", status: "APPROVED" });
    await submitToPartner("org1", "airwallex", true);
    expect(submit.mock.calls[0][0]).toMatchObject({ legalName: "Acme LLC", address: "1 Main St, Austin", city: "Austin", industry: "Software", expectedMonthlyUsd: 5000, contact: { firstName: "Ada", lastName: "Lovelace", email: "ada@acme.example" } });
  });
  it("live money proceeds once every partner on the route has approved", async () => {
    submit.mockResolvedValue({ partnerRef: "p-2", status: "APPROVED" });
    await expect(requireApprovedPartners("org1", route("airwallex", "wise"), false)).resolves.toBeUndefined();
  });
  it("a partner without an onboarding API waits for staff, and a submitted customer is not sent twice", async () => {
    await expect(requireApprovedPartners("org1", route("manual_partner"), false)).rejects.toMatchObject({ code: "PARTNER_ONBOARDING_PENDING" });
    expect(rows[0].status).toBe("SUBMITTED");
    rows[0].status = "APPROVED";
    await expect(requireApprovedPartners("org1", route("manual_partner"), false)).resolves.toBeUndefined();
    submit.mockResolvedValue({ partnerRef: "x", status: "SUBMITTED" });
    await submitToPartner("org1", "airwallex", false); await submitToPartner("org1", "airwallex", false);
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it("a partner that rejects the customer keeps live money closed", async () => {
    submit.mockResolvedValue({ partnerRef: "p-3", status: "REJECTED", note: "outside risk appetite" });
    await expect(requireApprovedPartners("org1", route("wise"), false)).rejects.toMatchObject({ code: "PARTNER_ONBOARDING_PENDING" });
    expect(rows[0].status).toBe("REJECTED");
  });
  it("an approved customer is never downgraded by a later call", async () => {
    rows.push({ id: "pcX", organizationId: "org1", partner: "wise", sandbox: false, status: "APPROVED", partnerRef: "w1", note: null });
    expect((await submitToPartner("org1", "wise", false)).status).toBe("APPROVED");
    expect(submit).not.toHaveBeenCalled();
  });
  it("a partner's own sandbox decides like the live one: it blocks until approved, and the customer is not created twice while the partner waits for them", async () => {
    submit.mockResolvedValue({ partnerRef: "n-1", status: "NEEDS_INFO", note: "Complete the identity check" });
    await expect(requireApprovedPartners("org1", route("nium"), true)).rejects.toMatchObject({ code: "PARTNER_ONBOARDING_PENDING" });
    await expect(requireApprovedPartners("org1", route("nium"), true)).rejects.toMatchObject({ code: "PARTNER_ONBOARDING_PENDING" });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({ partner: "nium", sandbox: true, status: "NEEDS_INFO", partnerRef: "n-1" });
  });
  it("a submission the partner never accepted (no reference) is tried again", async () => {
    submit.mockResolvedValueOnce({ partnerRef: "", status: "NEEDS_INFO", note: "Nium needs: incorporation date" });
    submit.mockResolvedValueOnce({ partnerRef: "n-2", status: "SUBMITTED" });
    await expect(requireApprovedPartners("org1", route("nium"), true)).rejects.toBeDefined();
    await expect(requireApprovedPartners("org1", route("nium"), true)).rejects.toBeDefined();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(rows[0]).toMatchObject({ partnerRef: "n-2", status: "SUBMITTED" });
  });
});

describe("the account partners return funds to", () => {
  it("is read from the KYB bank account in the country's own format", () => {
    expect(returnBankFrom("IN", "hdfc0001234|12345678901234", "Sharma Exports")).toEqual({ accountName: "Sharma Exports", accountNumber: "12345678901234", bankCountry: "IN", currency: "INR", routingType: "IFSC", routingValue: "HDFC0001234", bankName: "HDFC Bank" });
    expect(returnBankFrom("US", "021000021|123456789", "Acme")).toMatchObject({ bankCountry: "US", currency: "USD", routingType: "ACH CODE", routingValue: "021000021" });
    expect(returnBankFrom("AU", "062-000|12345678", "Acme")).toMatchObject({ currency: "AUD", routingType: "BSB", routingValue: "062000" });
    expect(returnBankFrom("DE", "DE89 3704 0044 0532 0130 00", "Acme")).toMatchObject({ accountNumber: "DE89370400440532013000", currency: "EUR", routingType: "" });
    expect(returnBankFrom("GB", "GB29NWBK60161331926819", "Acme")).toMatchObject({ currency: "GBP" });
    expect(returnBankFrom("MY", "MBBEMYKL|1234567890", "Acme")).toMatchObject({ routingType: "SWIFT", routingValue: "MBBEMYKL" });
    expect(returnBankFrom("IN", "garbage", "Acme")).toBeUndefined();
  });
});
