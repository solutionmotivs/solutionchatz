import http from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NiumClient, parseNiumRef } from "../lib/psp/nium/client";
import { NiumPartner, mapNiumStatus, niumBeneficiary } from "../lib/psp/nium/partner";
import { niumCorporatePayload, niumRegion } from "../lib/psp/nium/onboarding";
import { NiumFxProvider } from "../lib/fx/providers/nium";
import type { CustomerPackage } from "../lib/psp/stablecoin/partner";

const pkg = (extra: Partial<CustomerPackage> = {}): CustomerPackage => ({
  organizationId: "org_1", legalName: "Acme LLC", country: "US", registrationNumber: "123456789", taxId: null, businessType: "Private limited", riskTier: "MEDIUM", kybApprovedAt: "2026-10-01T00:00:00Z",
  address: "1 Main St", city: "Austin", state: "TX", postalCode: "73301", incorporationDate: "2019-05-21T00:00:00.000Z", industry: "Software", website: "https://acme.example", expectedMonthlyUsd: 40_000,
  people: [{ role: "APPLICANT", firstName: "Ada", lastName: "Lovelace", dateOfBirth: "1985-03-14", nationality: "US", ownershipPct: 100, email: "ada@acme.example", phone: "7337223608", phoneCountryCode: "1", address: { line1: "1 Main St", city: "Austin", state: "TX", postcode: "73301", country: "US" } }],
  returnBank: { accountName: "Acme LLC", accountNumber: "123456789", bankCountry: "US", currency: "USD", routingType: "ACH CODE", routingValue: "042100175" },
  consent: { acceptedAt: "2026-10-01T10:00:00Z", ip: "203.0.113.10", deviceInfo: "web", sessionId: "s1" }, ...extra,
});
const ENUMS = {
  monthlyTransactionVolume: ["MVUS01", "MVUS02", "MVUS03", "MVUS04", "MVUS05"].map(code => ({ code, description: code })),
  intendedUseOfAccount: [{ code: "IU001", description: "Receive payments for goods or services sold" }, { code: "IU002", description: "Pay suppliers and vendors" }],
  totalEmployees: [{ code: "EM006", description: "x" }], annualTurnover: [{ code: "US008", description: "<100k" }, { code: "US009", description: "100-500k" }, { code: "US010", description: "500k-1.5M" }, { code: "US011", description: "1.5M+" }],
  industrySector: [{ code: "IS134", description: "Software" }], monthlyTransactions: [{ code: "ATC01", description: "x" }], averageTransactionValue: [{ code: "ATVUS01", description: "x" }],
};

describe("Nium onboarding payload", () => {
  it("maps the country to Nium's regulatory region", () => { expect(niumRegion("US")).toBe("US"); expect(niumRegion("GB")).toBe("UK"); expect(niumRegion("DE")).toBe("EU"); expect(niumRegion("IN")).toBe("SG"); expect(niumRegion("AE")).toBe("SG"); });
  it("builds a complete corporate request from the verified package", () => {
    const { body, missing } = niumCorporatePayload(pkg(), ENUMS as never, new Date("2026-10-09T00:00:00Z"));
    expect(missing).toEqual([]);
    expect(body).toMatchObject({ type: "corporate", kycType: "full", region: "US", businessName: "Acme LLC", businessType: "limited_liability_company", registeredDate: "2019-05-21", applicantDeclaration: true, applicantDeclarationTimeStamp: "2026-10-01 10:00:00" });
    expect((body!.expectedAccountUsage as any).credit.monthlyTransactionVolume).toBe("MVUS04");
    expect((body!.applicant as any).positions.map((p: any) => p.title)).toEqual(["control_prong", "ubo"]);
    expect((body!.addresses as any).registeredAddress.state).toBe("US-TX");
  });
  it("lists what is missing instead of calling Nium with a thin profile", () => {
    const { body, missing } = niumCorporatePayload(pkg({ people: [], returnBank: undefined, incorporationDate: null }), ENUMS as never);
    expect(body).toBeUndefined();
    expect(missing).toEqual(expect.arrayContaining(["incorporation date", "a bank account for returns and refunds", "an applicant (the person applying for the business)"]));
  });
  it("never lets a future consent time through", () => { const { body } = niumCorporatePayload(pkg({ consent: { acceptedAt: "2030-01-01T00:00:00Z" } }), ENUMS as never, new Date("2026-10-09T03:00:00Z")); expect(body!.applicantDeclarationTimeStamp).toBe("2026-10-09 03:00:00"); });
});

describe("Nium status mapping and beneficiaries", () => {
  it("maps statuses", () => {
    expect(mapNiumStatus("clear", null).status).toBe("APPROVED");
    expect(mapNiumStatus("pending", "awaiting_kyc")).toEqual({ status: "NEEDS_INFO", needsAction: true });
    expect(mapNiumStatus("pending", "under_review").status).toBe("SUBMITTED");
    expect(mapNiumStatus("rejected", null).status).toBe("REJECTED");
    expect(mapNiumStatus("terminated", null).status).toBe("REJECTED");
  });
  it("builds an India beneficiary by IFSC and a US one by ABA", () => {
    expect(niumBeneficiary({ accountName: "Test Pvt Ltd", entityType: "COMPANY", bankCountry: "IN", currency: "INR", accountNumber: "12345678901234", ifsc: "HDFC0001234" })).toEqual({ beneficiary: { name: "Test Pvt Ltd", accountType: "CORPORATE", countryCode: "IN" }, paymentAccount: { accountNumber: "12345678901234", payoutMethod: "LOCAL", payoutCurrency: "INR", routingCode: [{ type: "IFSC", value: "HDFC0001234" }] } });
    expect((niumBeneficiary({ accountName: "A", entityType: "PERSONAL", bankCountry: "US", currency: "USD", accountNumber: "1", routingNumber: "111000000" }) as any).paymentAccount.routingCode).toEqual([{ type: "ACH CODE", value: "111000000" }]);
    expect(() => niumBeneficiary({ accountName: "A", entityType: "COMPANY", bankCountry: "IN", currency: "INR" })).toThrow(/RECIPIENT_BANK_DETAILS_MISSING/);
  });
  it("splits the customer reference", () => { expect(parseNiumRef("c1:w1")).toEqual({ customerHashId: "c1", walletHashId: "w1" }); });
});

describe("Nium adapter (contract test against a stub)", () => {
  const seen: { method: string; url: string; headers: http.IncomingHttpHeaders; body: any }[] = [];
  let custStatus = "clear"; let base = "";
  const server = http.createServer((rq, res) => {
    let b = ""; rq.on("data", c => (b += c));
    rq.on("end", () => {
      const body = b ? JSON.parse(b) : null; seen.push({ method: rq.method!, url: rq.url!, headers: rq.headers, body });
      const send = (c: number, j: unknown) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
      const u = rq.url!;
      if (u.startsWith("/api/v2/exchangeRate")) return send(200, { quoteId: "FX1", exchangeRate: 96.79, expiryDate: "2099-01-01 00:00:00" });
      if (u.includes("/onboarding/constants")) { const cat = new URL(u, "http://x").searchParams.get("category")!; return send(200, { data: (ENUMS as any)[cat] ?? [] }); }
      if (u.startsWith("/api/v5/client/C1/customers")) return send(200, { customerHashId: "cust1", status: "pending", subStatus: null, wallets: [{ walletHashId: "wal1" }] });
      if (u === "/api/v1/client/C1") return send(200, { name: "IAEX", paymentIds: [{ currencyCode: "USD", bankName: "CFSB_US" }] });
      if (u === "/api/v1/client/C1/customer/cust1") return send(200, { customerHashId: "cust1", status: custStatus, complianceStatus: "COMPLETED", paymentIds: seen.some(s => s.url.endsWith("/paymentId")) ? [{ currencyCode: "USD", bankName: "CFSB_US", uniquePaymentId: "8508", routingCodeType1: "ABA (ACH)", routingCodeValue1: "026073150" }] : [] });
      if (u.endsWith("/paymentId")) return send(200, { bankName: "CFSB_US", currencyCode: "USD", uniquePaymentId: "8508" });
      if (u.endsWith("/remittance")) return send(200, { message: "Transfer Initiated", system_reference_number: "RT123" });
      send(404, {});
    });
  });
  beforeAll(async () => { await new Promise<void>(r => server.listen(0, "127.0.0.1", r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
  afterAll(() => { server.close(); });
  const client = () => new NiumClient({ baseUrl: base, apiKey: "k", clientHashId: "C1", clientName: "vaulte" });
  const partner = () => new NiumPartner(client(), "secret-key");

  it("sends the key, a fresh request id and the client name on every call", async () => {
    await client().exchangeRate({ sourceCurrencyCode: "USD", destinationCurrencyCode: "INR" });
    const a = seen[seen.length - 1]; expect(a.headers["x-api-key"]).toBe("k"); expect(a.headers["x-client-name"]).toBe("vaulte"); expect(String(a.headers["x-request-id"])).toHaveLength(36);
  });
  it("FX provider returns the rate on IMPS for India", async () => {
    const q = await new NiumFxProvider(client()).quote({ sourceCurrency: "USD", destCurrency: "INR", sourceAmountMinor: 1_000_000, destCountry: "IN" });
    expect(q).toMatchObject({ provider: "nium", rate: 96.79, rail: "IMPS" });
  });
  it("onboards the customer and keeps customer and wallet in the reference", async () => {
    const r = await partner().submitCustomer(pkg());
    expect(r).toMatchObject({ partnerRef: "cust1:wal1", status: "SUBMITTED" });
    const call = seen.find(s => s.url.startsWith("/api/v5/client/C1/customers"))!;
    expect(call.body.businessName).toBe("Acme LLC");
  });
  it("a thin package is reported as NEEDS_INFO without calling Nium", async () => {
    seen.length = 0;
    const r = await partner().submitCustomer(pkg({ people: [] }));
    expect(r.status).toBe("NEEDS_INFO"); expect(seen.some(s => s.url.startsWith("/api/v5"))).toBe(false);
  });
  it("status call and the customer's own account details", async () => {
    custStatus = "clear";
    expect((await partner().getCustomerStatus("cust1:wal1")).status).toBe("APPROVED");
    const f = await partner().createFiatFunding({ transferId: "T1", currency: "USD", amountMinor: 100n, customerRef: "cust1:wal1" });
    expect(f.bankDetails).toMatchObject({ account_number: "8508", currency: "USD", reference: "T1" });
    await expect(partner().createFiatFunding({ transferId: "T1", currency: "USD", amountMinor: 1n })).rejects.toThrow(/onboard the customer first/);
  });
  it("pays from the customer's wallet with an inline beneficiary and returns Nium's reference", async () => {
    seen.length = 0;
    const r = await partner().createPayout({ transferId: "T1", route: { legs: [{ srcCurrency: "USD", rails: ["IMPS"] }] } as never, destCurrency: "INR", destAmountMinor: 500000n, recipientName: "X", recipientCountry: "IN", customerRef: "cust1:wal1", beneficiary: { accountName: "Test Pvt Ltd", entityType: "COMPANY", bankCountry: "IN", currency: "INR", accountNumber: "12345678901234", ifsc: "HDFC0001234" } });
    expect(r.partnerRef).toBe("RT123");
    const call = seen.find(s => s.url.endsWith("/remittance"))!;
    expect(call.url).toBe("/api/v1/client/C1/customer/cust1/wallet/wal1/remittance");
    expect(call.body).toMatchObject({ payout: { sourceCurrency: "USD", destinationAmount: 5000 }, purposeCode: "IR001", sourceOfFunds: "Corporate Account" });
  });

  it("webhook: only the shared partner key is accepted", () => {
    const p = partner();
    expect(p.verifyWebhook("{}", new Headers({ "x-partner-key": "secret-key" }))).toBe(true);
    expect(p.verifyWebhook("{}", new Headers({ "x-partner-key": "wrong" }))).toBe(false);
    expect(p.verifyWebhook("{}", new Headers())).toBe(false);
  });
  it("webhook: customer status and payout events become Vaulte events, others are ignored", () => {
    const p = partner(); const h = new Headers({ "x-request-id": "req-1" });
    expect(p.normalizeWebhook({ template: "CUSTOMER_STATUS_WEBHOOK", customerHashId: "cust1", status: "pending", subStatus: "awaiting_kyc" }, h)).toMatchObject({ id: "req-1", type: "customer.status", data: { customer_ref: "cust1", state: "NEEDS_INFO" } });
    expect(p.normalizeWebhook({ template: "CUSTOMER_STATUS_WEBHOOK", customerHashId: "cust1", status: "clear" }, h)).toMatchObject({ data: { state: "APPROVED" } });
    expect(p.normalizeWebhook({ template: "REMIT_TRANSACTION_PAID_WEBHOOK", systemReferenceNumber: "RT1" }, h)).toEqual({ id: "req-1", type: "payout.completed", data: { transfer_ref: "RT1" } });
    expect(p.normalizeWebhook({ template: "REMIT_TRANSACTION_RETURNED_WEBHOOK", systemReferenceNumber: "RT1" }, h)).toMatchObject({ type: "payout.failed", data: { transfer_ref: "RT1", reason: "returned" } });
    expect(p.normalizeWebhook({ template: "REMIT_TRANSACTION_SENT_TO_BANK_WEBHOOK", systemReferenceNumber: "RT1" }, h)).toBeNull();
    expect(p.normalizeWebhook({ template: "CARD_POS_APPROVED_WEBHOOK" }, h)).toBeNull();
  });
});
