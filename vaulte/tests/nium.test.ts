import http from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NiumClient, parseNiumRef } from "../lib/psp/nium/client";
import { NiumPartner, mapNiumPayoutStatus, mapNiumStatus, niumBeneficiary } from "../lib/psp/nium/partner";
import { isResidentOf, niumBusinessType, niumCorporatePayload, niumInfoRequest, niumRegion, niumRfiResponseItem } from "../lib/psp/nium/onboarding";
import type { NiumRfiTemplate } from "../lib/psp/nium/client";
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
  businessType: ["TRUST", "CORPORATION", "SOLE_TRADER", "PUBLIC_COMPANY", "LIMITED_LIABILITY_COMPANY"].map(code => ({ code, description: code })),
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
  let custStatus = "clear"; let base = ""; let withApplicant = false; let filesMissing = false; let tooEarly = false; let kycError = false; let v5: Record<string, unknown> | null = null; let rfiTemplates: NiumRfiTemplate[] = [];
  const server = http.createServer((rq, res) => {
    let b = ""; rq.on("data", c => (b += c));
    rq.on("end", () => {
      const body = b && /json/.test(String(rq.headers["content-type"] ?? "")) ? JSON.parse(b) : null; seen.push({ method: rq.method!, url: rq.url!, headers: rq.headers, body });
      const send = (c: number, j: unknown) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
      const u = rq.url!;
      if (u.startsWith("/api/v2/exchangeRate")) return send(200, { quoteId: "FX1", exchangeRate: 96.79, expiryDate: "2099-01-01 00:00:00" });
      if (u.includes("/onboarding/constants")) { const cat = new URL(u, "http://x").searchParams.get("category")!; return send(200, { data: (ENUMS as any)[cat] ?? [] }); }
      if (u.startsWith("/api/v5/client/C1/customers")) return send(200, { customerHashId: "cust1", status: "pending", subStatus: null, wallets: [{ walletHashId: "wal1" }], ...(withApplicant ? { applicant: { externalId: "applicant1", referenceId: "app-ref", firstName: "Ada", lastName: "Lovelace", kycStatus: "kyc_required", address: { country: "US" } } } : {}) });
      if (u === "/api/v1/client/C1/files" && rq.method === "POST") return filesMissing ? send(403, { message: "Missing Authentication Token" }) : send(200, { fileId: "file-1" });
      if (u === "/api/v5/client/C1/customer/cust1/submitKyc" && tooEarly) return send(400, { errors: [{ code: "invalid_input", description: "Customer creation is under progress. Please try again after some time" }] });
      if (u === "/api/v5/client/C1/customer/cust1/submitKyc" && !kycError && v5?.applicant) v5 = { ...v5, subStatus: "awaiting_kyc", applicant: { ...(v5.applicant as object), kycStatus: "initiated", biometricUrl: "https://idv.example/check?ref=1" } };
      if (u === "/api/v5/client/C1/customer/cust1/submitKyc") return kycError ? send(400, { errors: [{ code: "invalid_input", description: "Unsupported kycMode: biometric_kyc" }] }) : send(200, { kycStatus: "initiated", referenceId: "app-ref", kycMode: "biometric_kyc", biometricUrl: "https://idv.example/check?ref=1" });
      if (u === "/api/v5/client/C1/customer/cust1" && v5) return send(200, v5);
      if (u.startsWith("/api/v1/client/C1/corporate/rfi") && rq.method === "GET") return send(200, { rfiTemplates });
      if (u === "/api/v1/client/C1/corporate/rfi" && rq.method === "POST") return send(200, { message: "RFI responded" });
      if (u === "/api/v1/client/C1") return send(200, { name: "IAEX", paymentIds: [{ currencyCode: "USD", bankName: "CFSB_US" }] });
      if (u === "/api/v1/client/C1/customer/cust1") return send(200, { customerHashId: "cust1", status: custStatus, complianceStatus: "COMPLETED", paymentIds: seen.some(s => s.url.endsWith("/paymentId")) ? [{ currencyCode: "USD", bankName: "CFSB_US", uniquePaymentId: "8508", routingCodeType1: "ABA (ACH)", routingCodeValue1: "026073150" }] : [] });
      if (u.endsWith("/paymentId")) return send(200, { bankName: "CFSB_US", currencyCode: "USD", uniquePaymentId: "8508" });
      if (u.endsWith("/wallet/wal1/transactions")) return send(200, { content: [
        { transactionType: "Wallet_Credit_Mode_Offline_ThirdParty", status: "Approved", settlementStatus: "Settled", debit: false, authCode: "FW1", authAmount: 5000, authCurrencyCode: "USD", createdAt: "2099-01-01 00:00:00", labels: { remitterName: "Acme Payer Inc", bankReferenceNumber: "BANK1" } },
        { transactionType: "Wallet_Credit_Mode_Offline_ThirdParty", status: "Pending", settlementStatus: "Unsettled", debit: false, authCode: "FW2", authAmount: 10, authCurrencyCode: "USD", createdAt: "2099-01-01 00:00:00", labels: {} },
        { transactionType: "Remittance_Debit", status: "Approved", settlementStatus: "Settled", debit: true, authCode: "RT123", authAmount: 51.67, authCurrencyCode: "USD", createdAt: "2099-01-01 00:00:00", labels: {} },
        { transactionType: "Wallet_Credit_Mode_Offline_ThirdParty", status: "Approved", settlementStatus: "Settled", debit: false, authCode: "FWOLD", authAmount: 1, authCurrencyCode: "USD", createdAt: "2001-01-01 00:00:00", labels: {} },
      ] });
      if (u.endsWith("/remittance/RT123/audit")) return send(200, [{ systemReferenceNumber: "RT123", status: "SENT_TO_BANK", lastUpdatedAt: "2026-10-10 03:08:53" }, { systemReferenceNumber: "RT123", status: "PAID", lastUpdatedAt: "2026-10-10 03:10:04" }, { systemReferenceNumber: "RT123", status: "INITIATED", lastUpdatedAt: "2026-10-10 03:08:00" }]);
      if (u.endsWith("/remittance/RT999/audit")) return send(200, [{ systemReferenceNumber: "RT999", status: "RETURN", statusDetails: "Beneficiary bank returned it", lastUpdatedAt: "2026-10-10 03:10:04" }, { systemReferenceNumber: "RT999", status: "SENT_TO_BANK", lastUpdatedAt: "2026-10-10 03:08:53" }]);
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
    expect(p.normalizeWebhook({ template: "REMIT_TRANSACTION_PAID_WEBHOOK", systemReferenceNumber: "RT1" }, h)).toEqual({ id: "payout:RT1:paid", type: "payout.completed", data: { transfer_ref: "RT1" } });
    expect(p.normalizeWebhook({ template: "REMIT_TRANSACTION_RETURNED_WEBHOOK", systemReferenceNumber: "RT1" }, h)).toMatchObject({ type: "payout.failed", data: { transfer_ref: "RT1", reason: "returned" } });
    expect(p.normalizeWebhook({ template: "REMIT_TRANSACTION_SENT_TO_BANK_WEBHOOK", systemReferenceNumber: "RT1" }, h)).toBeNull();
    // a wallet credit becomes a funds event whose id is the credit's own reference (so polling the same credit is a duplicate)
    expect(p.normalizeWebhook({ template: "CARD_WALLET_FUNDING_WEBHOOK", customerHashId: "cust1", walletHashId: "wal1", transactionCurrency: "USD", transactionAmount: "5000.50", authCode: "FW9" }, h)).toEqual({ id: "funds:FW9", type: "customer.funds_received", data: { customer_ref: "cust1", currency: "USD", amount_minor: "500050", credit_id: "FW9" } });
    expect(p.normalizeWebhook({ template: "INCOMING_FUNDS_WEBHOOK", bankReferenceNumber: "B1", transactionCurrency: "USD", transactionAmount: 10, remitterName: "X" }, h)).toMatchObject({ type: "funds.unmatched" });
    expect(p.normalizeWebhook({ template: "CARD_POS_APPROVED_WEBHOOK" }, h)).toBeNull();
  });
  it("starts each person's identity check after creating the customer and returns the hosted link as the next step", async () => {
    withApplicant = true; seen.length = 0;
    const r = await partner().submitCustomer(pkg());
    withApplicant = false;
    const kyc = seen.find(x => x.url.endsWith("/submitKyc"))!;
    expect(kyc.body).toEqual({ region: "US", entityType: "applicant", isResident: true, kycMode: "biometric_kyc", entityReferenceId: "app-ref" });
    expect(r).toMatchObject({ partnerRef: "cust1:wal1", status: "NEEDS_INFO", actionUrl: "https://idv.example/check?ref=1" });
    expect(r.note).toContain("Ada Lovelace must complete Nium's identity check");
  });
  it("a call that is too early (Nium is still creating the customer) is left to the status poll, which then starts the identity check", async () => {
    withApplicant = true; tooEarly = true; seen.length = 0; process.env.NIUM_RETRY_MS = "1";
    const r = await partner().submitCustomer(pkg());
    withApplicant = false; delete process.env.NIUM_RETRY_MS;
    expect(r.status).toBe("SUBMITTED"); expect(r.note).toContain("still creating the customer");
    tooEarly = false;
    v5 = { customerHashId: "cust1", region: "US", status: "pending", subStatus: null, applicant: { externalId: "applicant1", referenceId: "app-ref", firstName: "Ada", lastName: "Lovelace", kycStatus: "kyc_required", address: { country: "IN" } } };
    seen.length = 0;
    const st = await partner().getCustomerStatus("cust1:wal1");
    expect(seen.find(x => x.url.endsWith("/submitKyc"))!.body).toMatchObject({ isResident: false, kycMode: "biometric_kyc", entityReferenceId: "app-ref" });
    expect(st.status).toBe("NEEDS_INFO");
    v5 = null;
  });
  it("a refused identity check is reported with Nium's reason instead of failing the submission", async () => {
    withApplicant = true; kycError = true;
    const r = await partner().submitCustomer(pkg());
    withApplicant = false; kycError = false;
    expect(r.status).toBe("NEEDS_INFO"); expect(r.note).toContain("Unsupported kycMode: biometric_kyc");
  });
  it("reads status from the v5 record, with the link of the next person who still has to complete the check", async () => {
    v5 = { customerHashId: "cust1", status: "pending", subStatus: "awaiting_kyc", applicant: { firstName: "Ada", lastName: "Lovelace", kycStatus: "initiated", biometricUrl: "https://idv.example/check?ref=2" } };
    expect(await partner().getCustomerStatus("cust1:wal1")).toMatchObject({ status: "NEEDS_INFO", actionUrl: "https://idv.example/check?ref=2" });
    v5 = { customerHashId: "cust1", status: "clear", subStatus: null };
    expect((await partner().getCustomerStatus("cust1:wal1")).status).toBe("APPROVED");
    v5 = null;
  });
  it("lists Nium's open questions and answers one in the shape Nium expects", async () => {
    rfiTemplates = [
      { rfiHashId: "r-old", status: "RFI_RESPONDED", remarks: "done", template: { name: "otherData", type: "data", rfiType: "corporate", requiredFields: [{ fieldLabel: "Other Data", fieldValue: "otherData", type: "data" }] } },
      { rfiHashId: "r1", referenceId: "app-ref", status: "RFI_REQUESTED", remarks: "Provide a valid passport", template: { name: "applicantIdentity", type: "document", rfiType: "applicant", documentType: "POI", requiredFields: [{ fieldLabel: "Identity Document Type", fieldValue: "documentType", type: "data" }, { fieldLabel: "Identity Document Expiry Date", fieldValue: "documentExpiryDate", type: "data" }, { fieldLabel: "Identity Document", fieldValue: "document", type: "document" }] } },
    ];
    const list = await partner().listInfoRequests("cust1:wal1");
    expect(list.map(x => [x.id, x.status])).toEqual([["r1", "OPEN"], ["r-old", "ANSWERED"]]);
    expect(list[0]).toMatchObject({ title: "Applicant's identity document", fields: [{ key: "documentType", kind: "text" }, { key: "documentExpiryDate", kind: "date" }, { key: "document", kind: "file" }] });
    seen.length = 0; v5 = { customerHashId: "cust1", region: "US" };
    await partner().answerInfoRequest("cust1:wal1", "r1", { values: { documentType: "Passport", documentExpiryDate: "2030-01-01" }, files: { document: { name: "p.png", mime: "image/png", dataBase64: "AAAA" } } });
    v5 = null;
    const post = seen.find(x => x.method === "POST" && x.url === "/api/v1/client/C1/corporate/rfi")!;
    expect(post.body).toEqual({ region: "US", customerHashId: "cust1", rfiResponseRequest: [{ rfiHashId: "r1", businessDetails: { applicantDetails: { referenceId: "app-ref", documentDetails: { documentType: "Passport", documentExpiryDate: "2030-01-01", document: [{ document: "AAAA", fileName: "p.png", fileType: "image/png" }] } } } }] });
    await expect(partner().answerInfoRequest("cust1:wal1", "r-old", { values: {}, files: {} })).rejects.toThrow(/already been answered/);
    await expect(partner().answerInfoRequest("cust1:wal1", "nope", { values: {}, files: {} })).rejects.toThrow(/no longer open/);
  });
  it("uploads the verified business document and references its file id when the customer is created", async () => {
    seen.length = 0;
    const load = async () => Buffer.from("%PDF-1.4 test");
    await partner().submitCustomer(pkg({ documentFiles: [{ kind: "CERT_OF_INCORPORATION", filename: "coi.pdf", mime: "application/pdf", load }] }));
    expect(seen.some(x => x.url === "/api/v1/client/C1/files" && x.method === "POST")).toBe(true);
    expect(seen.find(x => x.url.startsWith("/api/v5/client/C1/customers"))!.body.documents).toEqual([{ type: "business_registration_doc", fileIds: ["file-1"] }]);
  });
  it("without a file route the sandbox can use a configured test file id, and live never does", async () => {
    filesMissing = true; process.env.NIUM_TEST_FILE_ID = "test-file";
    const load = async () => Buffer.from("x"); const doc = { kind: "CERT_OF_INCORPORATION", filename: "coi.pdf", mime: "application/pdf", load };
    seen.length = 0; await partner().submitCustomer(pkg({ documentFiles: [doc] }));
    expect(seen.find(x => x.url.startsWith("/api/v5/client/C1/customers"))!.body.documents).toEqual([{ type: "business_registration_doc", fileIds: ["test-file"] }]);
    const live = new NiumPartner(new NiumClient({ baseUrl: base, apiKey: "k", clientHashId: "C1", clientName: "vaulte" }), "secret-key");
    process.env.NIUM_ENV = "live";
    const r = await live.submitCustomer(pkg({ documentFiles: [doc] }));
    delete process.env.NIUM_ENV; delete process.env.NIUM_TEST_FILE_ID; filesMissing = false;
    expect(r.status).toBe("NEEDS_INFO"); expect(r.note).toContain("could not take the business document");
  });
  it("lists only settled credits on the customer's wallet since the transfer was created", async () => {
    const credits = await partner().listFundsReceived("cust1:wal1", new Date("2098-12-31T00:00:00Z"));
    expect(credits).toEqual([{ id: "FW1", currency: "USD", amountMinor: 500000n, senderName: "Acme Payer Inc", bankReference: "BANK1", at: "2099-01-01 00:00:00" }]);
  });
  it("reads a payout's latest status from its audit trail", async () => {
    expect(await partner().getPayoutStatus("RT123", "cust1:wal1")).toEqual({ state: "PAID" });
    expect(await partner().getPayoutStatus("RT999", "cust1:wal1")).toMatchObject({ state: "FAILED", reason: expect.stringContaining("return") });
    expect(await partner().getPayoutStatus("RT123")).toEqual({ state: "PENDING" });
  });
});

describe("Nium payout status mapping", () => {
  it("maps the remittance statuses", () => {
    for (const st of ["INITIATED", "IN_PROGRESS", "COMPLIANCE_COMPLETED", "SENT_TO_BANK", "RFI_REQUESTED", ""]) expect(mapNiumPayoutStatus(st).state).toBe("PENDING");
    expect(mapNiumPayoutStatus("PAID").state).toBe("PAID");
    for (const st of ["REJECTED", "RETURN", "RETURNED", "EXPIRED", "CANCELLED", "ERROR"]) expect(mapNiumPayoutStatus(st).state).toBe("FAILED");
  });
});

describe("Nium information requests (RFIs)", () => {
  const tpl = (name: string, type: "data" | "document", rfiType: "corporate" | "applicant" | "stakeholder", fields: [string, string, "data" | "document"][], referenceId?: string): NiumRfiTemplate => ({ rfiHashId: `h-${name}`, referenceId, status: "RFI_REQUESTED", template: { name, type, rfiType, requiredFields: fields.map(([fieldLabel, fieldValue, t]) => ({ fieldLabel, fieldValue, type: t })) } });
  const file = { document: { name: "a.pdf", mime: "application/pdf", dataBase64: "QQ==" } };
  it("shapes each template's response like the onboarding request", () => {
    expect(niumRfiResponseItem(tpl("businessName", "data", "corporate", [["Business Name", "businessName", "data"]]), { values: { businessName: "Acme LLC" }, files: {} })).toEqual({ rfiHashId: "h-businessName", businessDetails: { businessName: "Acme LLC" } });
    expect(niumRfiResponseItem(tpl("otherData", "data", "corporate", [["Other Data", "otherData", "data"]]), { values: { otherData: "We sell software" }, files: {} })).toEqual({ rfiHashId: "h-otherData", businessDetails: { additionalInfo: { otherData: "We sell software" } } });
    expect(niumRfiResponseItem(tpl("transactionCountries", "data", "corporate", [["Payment Corridors", "transactionCountries", "data"]]), { values: { transactionCountries: "us, in;ae" }, files: {} })).toEqual({ rfiHashId: "h-transactionCountries", riskAssessmentInfo: { transactionCountries: ["US", "IN", "AE"] } });
    expect(niumRfiResponseItem(tpl("intendedUseOfAccount", "data", "corporate", [["Use", "intendedUseOfAccount", "data"]]), { values: { intendedUseOfAccount: "IU001" }, files: {} })).toEqual({ rfiHashId: "h-intendedUseOfAccount", riskAssessmentInfo: { intendedUseOfAccount: "IU001" } });
    expect(niumRfiResponseItem(tpl("businessRegistrationDocument", "document", "corporate", [["Business Registration Document", "document", "document"]]), { values: {}, files: file })).toEqual({ rfiHashId: "h-businessRegistrationDocument", businessDetails: { documentDetails: { document: [{ document: "QQ==", fileName: "a.pdf", fileType: "application/pdf" }] } } });
    expect(niumRfiResponseItem(tpl("stakeholderAddress", "document", "stakeholder", [["Type", "documentType", "data"], ["Proof", "document", "document"]], "st-ref"), { values: { documentType: "Utility Bill" }, files: file })).toEqual({ rfiHashId: "h-stakeholderAddress", businessDetails: { stakeholders: [{ referenceId: "st-ref", stakeholderDetails: { documentDetails: { documentType: "Utility Bill", document: [{ document: "QQ==", fileName: "a.pdf", fileType: "application/pdf" }] } } }] } });
  });
  it("lists what is missing instead of sending an incomplete answer, and refuses templates it cannot answer", () => {
    expect(() => niumRfiResponseItem(tpl("applicantIdentity", "document", "applicant", [["Identity Document Number", "documentNumber", "data"], ["Identity Document", "document", "document"]], "r"), { values: {}, files: {} })).toThrow(/INFO_REQUEST_INCOMPLETE: Identity Document Number, Identity Document/);
    expect(() => niumRfiResponseItem(tpl("somethingNew", "data", "corporate", [["X", "x", "data"]]), { values: { x: "1" }, files: {} })).toThrow(/INFO_REQUEST_UNSUPPORTED/);
  });
  it("turns a link in the remarks into the step to open", () => {
    expect(niumInfoRequest({ ...tpl("applicantreKyc", "document", "applicant", []), remarks: "Please complete the selfie check at https://idv.example/x?y=1 today" })).toMatchObject({ url: "https://idv.example/x?y=1", title: "Applicantre Kyc" });
  });
  it("decides residence the way Nium's regions work", () => {
    expect(isResidentOf("US", "US")).toBe(true); expect(isResidentOf("US", "IN")).toBe(false); expect(isResidentOf("UK", "GB")).toBe(true); expect(isResidentOf("EU", "DE")).toBe(true);
    expect(isResidentOf("SG", "SG")).toBe(true); expect(isResidentOf("SG", "IN")).toBe(false); expect(isResidentOf("SG", "AE")).toBe(false);
  });
});

describe("Nium business type", () => {
  const list = (...codes: string[]) => codes.map(code => ({ code }));
  it("uses the code the customer's region offers for the same legal form", () => {
    const us = list("TRUST", "CORPORATION", "LIMITED_LIABILITY_COMPANY", "SOLE_TRADER"), sg = list("TRUST", "OTHERS", "PARTNERSHIP", "PRIVATE_COMPANY", "PUBLIC_COMPANY");
    expect(niumBusinessType("Private limited", us)).toBe("limited_liability_company");
    expect(niumBusinessType("Private limited", sg)).toBe("private_company");
    expect(niumBusinessType("LLC", us)).toBe("limited_liability_company");
    expect(niumBusinessType("Partnership firm", sg)).toBe("partnership");
    expect(niumBusinessType("Sole proprietorship", us)).toBe("sole_trader");
    expect(niumBusinessType("Public limited", sg)).toBe("public_company");
    expect(niumBusinessType("something unusual", list("OTHERS", "TRUST"))).toBe("others");
    expect(niumBusinessType(null, undefined)).toBe("private_company");
  });
});
