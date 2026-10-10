import http from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CurrencycloudClient, parseCustomerRef } from "../lib/psp/currencycloud/client";
import { CurrencycloudPartner, ccAccountFromPackage } from "../lib/psp/currencycloud/partner";
import type { CustomerPackage } from "../lib/psp/stablecoin/partner";

const pkg = (extra: Partial<CustomerPackage> = {}): CustomerPackage => ({
  organizationId: "org_1", legalName: "Kyc Exports Pvt Ltd", country: "GB", registrationNumber: "CN12345", taxId: null, businessType: "Private limited", riskTier: "MEDIUM", kybApprovedAt: "2026-10-01T00:00:00Z",
  address: "1 Test Street", city: "London", postalCode: "E1 6AN", incorporationDate: "2018-04-02T00:00:00.000Z", industry: "Textile exports", website: "https://example.com", expectedMonthlyUsd: 40_000,
  contact: { firstName: "Test", lastName: "Owner", email: "owner@example.com", phone: "+441234567890" }, ...extra,
});

describe("Currencycloud customer sub-accounts (contract test against a stub)", () => {
  const seen: { method: string; url: string; headers: http.IncomingHttpHeaders; form: URLSearchParams }[] = [];
  let accountStatus = "enabled"; let base = "";
  const server = http.createServer((rq, res) => {
    let b = ""; rq.on("data", c => (b += c));
    rq.on("end", () => {
      const form = new URLSearchParams(b); seen.push({ method: rq.method!, url: rq.url!, headers: rq.headers, form });
      const send = (c: number, j: unknown) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
      if (rq.url === "/v2/authenticate/api") return send(200, { auth_token: "t1" });
      if (rq.url === "/v2/accounts/create") return send(200, { id: "acct-1", status: accountStatus, short_reference: "261008-1" });
      if (rq.url === "/v2/contacts/create") return send(200, { id: "cont-1", account_id: form.get("account_id") });
      if (rq.url!.startsWith("/v2/accounts/acct-1")) return send(200, { id: "acct-1", status: accountStatus });
      if (rq.url!.startsWith("/v2/funding_accounts/find")) return send(200, { funding_accounts: [{ id: "fa-1", account_holder_name: "Kyc Exports Pvt Ltd", account_number: "94114219", routing_code: "123456", routing_code_type: "sort_code" }] });
      if (rq.url === "/v2/beneficiaries/create") return send(200, { id: "ben-1" });
      if (rq.url === "/v2/conversions/create") return send(200, { id: "conv-1" });
      if (rq.url === "/v2/payments/create") return send(200, { id: "pay-1", status: "ready_to_send" });
      send(404, {});
    });
  });
  beforeAll(async () => { await new Promise<void>(r => server.listen(0, "127.0.0.1", r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
  afterAll(() => { server.close(); });
  const partner = () => new CurrencycloudPartner(new CurrencycloudClient({ baseUrl: base, loginId: "me", apiKey: "k" }));

  it("maps the approved KYB profile to Currencycloud's account fields", () => {
    const { params, missing } = ccAccountFromPackage(pkg());
    expect(missing).toEqual([]);
    expect(params).toMatchObject({ account_name: "Kyc Exports Pvt Ltd", legal_entity_sub_type: "limited_liability_company", identification_value: "CN12345", country_of_incorporation: "GB", date_of_incorporation: "2018-04-02", industry_type: "textile_exports", customer_risk: "MEDIUM", expected_monthly_activity_value: 40000, expected_transaction_currencies: ["USD"] });
  });
  it("lists what is missing instead of calling the partner with a half-empty profile", async () => {
    const r = await partner().submitCustomer(pkg({ address: null, incorporationDate: null, registrationNumber: null }));
    expect(r.status).toBe("NEEDS_INFO"); expect(r.note).toMatch(/registered address.*registration number.*incorporation date/);
    expect(seen.some(s => s.url === "/v2/accounts/create")).toBe(false);
  });
  it("opens the sub-account and the owner's contact, and reports APPROVED when the account is enabled", async () => {
    const r = await partner().submitCustomer(pkg());
    expect(r).toMatchObject({ partnerRef: "acct-1:cont-1", status: "APPROVED" });
    const create = seen.find(s => s.url === "/v2/accounts/create")!;
    expect(create.form.getAll("expected_transaction_countries[]")).toEqual(["GB"]);
    const contact = seen.find(s => s.url === "/v2/contacts/create")!;
    expect(contact.form.get("account_id")).toBe("acct-1"); expect(contact.form.get("email_address")).toBe("owner@example.com");
  });
  it("a not-yet-enabled account stays SUBMITTED and the status call moves it on", async () => {
    accountStatus = "pending";
    const p = partner();
    expect((await p.submitCustomer(pkg())).status).toBe("SUBMITTED");
    expect((await p.getCustomerStatus("acct-1:cont-1")).status).toBe("SUBMITTED");
    accountStatus = "enabled";
    expect((await p.getCustomerStatus("acct-1:cont-1")).status).toBe("APPROVED");
    accountStatus = "closed";
    expect((await p.getCustomerStatus("acct-1:cont-1")).status).toBe("REJECTED");
    accountStatus = "enabled";
  });
  it("funding details and the payout act on behalf of the customer's contact, never the master account", async () => {
    seen.length = 0;
    const p = partner();
    const f = await p.createFiatFunding({ transferId: "tr_1", currency: "GBP", amountMinor: 100_000n, customerRef: "acct-1:cont-1" });
    expect(f.bankDetails.account_name).toBe("Kyc Exports Pvt Ltd");
    expect(seen.find(s => s.url.startsWith("/v2/funding_accounts/find"))!.url).toContain("on_behalf_of=cont-1");
    await p.createPayout({ transferId: "tr_1", route: { legs: [{ srcCurrency: "GBP", destCurrency: "EUR", rails: ["SEPA"] }] } as never, destCurrency: "EUR", destAmountMinor: 10_000n, recipientName: "ACME", recipientCountry: "DE", customerRef: "acct-1:cont-1", beneficiary: { accountName: "ACME", entityType: "COMPANY", bankCountry: "DE", currency: "EUR", iban: "DE89370400440532013000" } });
    for (const u of ["/v2/beneficiaries/create", "/v2/conversions/create", "/v2/payments/create"]) expect(seen.find(s => s.url === u)!.form.get("on_behalf_of"), u).toBe("cont-1");
  });
  it("without a customer reference nothing is sent on behalf of anyone", async () => {
    seen.length = 0;
    await partner().createFiatFunding({ transferId: "tr_2", currency: "GBP", amountMinor: 1n });
    expect(seen.find(s => s.url.startsWith("/v2/funding_accounts/find"))!.url).not.toContain("on_behalf_of");
  });
  it("splits the customer reference", () => { expect(parseCustomerRef("a:b")).toEqual({ accountId: "a", contactId: "b" }); expect(parseCustomerRef("a")).toEqual({ accountId: "a", contactId: "a" }); });
});
