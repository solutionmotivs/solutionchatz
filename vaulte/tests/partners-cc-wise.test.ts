import http from "node:http";
import { AddressInfo } from "node:net";
import { generateKeyPairSync, createSign } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CurrencycloudClient } from "../lib/psp/currencycloud/client";
import { CurrencycloudPartner, ccBeneficiary } from "../lib/psp/currencycloud/partner";
import { CurrencycloudFxProvider } from "../lib/fx/providers/currencycloud";
import { WiseClient } from "../lib/psp/wise/client";
import { WisePartner, wiseRecipient } from "../lib/psp/wise/partner";
import { WiseFxProvider } from "../lib/fx/providers/wise";
import type { PayoutRequest } from "../lib/psp/stablecoin/partner";

const route = (src: string): any => ({ legs: [{ srcCurrency: src, destCurrency: "EUR", rails: ["SEPA"] }] });
const req = (extra: Partial<PayoutRequest> = {}): PayoutRequest => ({
  transferId: "tr_1", route: route("USD"), destCurrency: "EUR", destAmountMinor: 12_345n, recipientName: "ACME GmbH", recipientCountry: "DE", invoiceNumber: "INV-1",
  beneficiary: { accountName: "ACME GmbH", entityType: "COMPANY", bankCountry: "DE", currency: "EUR", iban: "DE89370400440532013000" }, ...extra,
});

function stub(handler: (req: http.IncomingMessage, body: string, send: (c: number, j: unknown) => void) => void) {
  const seen: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
  const server = http.createServer((rq, res) => {
    let b = ""; rq.on("data", c => (b += c));
    rq.on("end", () => { seen.push({ method: rq.method!, url: rq.url!, headers: rq.headers, body: b }); handler(rq, b, (c, j) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(j)); }); });
  });
  return { server, seen, start: async () => { await new Promise<void>(r => server.listen(0, "127.0.0.1", r)); return `http://127.0.0.1:${(server.address() as AddressInfo).port}`; } };
}

describe("Currencycloud adapter (contract test against a stub)", () => {
  let logins = 0; let base = ""; let expire401 = false;
  const s = stub((rq, body, send) => {
    const form = new URLSearchParams(body);
    if (rq.url === "/v2/authenticate/api") { logins++; return form.get("api_key") === "good" ? send(200, { auth_token: `t${logins}` }) : send(401, { error_code: "auth_failed", error_messages: { api_key: [{ message: "bad" }] } }); }
    if (!String(rq.headers["x-auth-token"]).startsWith("t")) return send(401, {});
    if (expire401) { expire401 = false; return send(401, {}); }
    if (rq.url!.startsWith("/v2/rates/detailed")) return send(200, { client_rate: "0.9", client_buy_amount: "90.00", client_sell_amount: "100.00" });
    if (rq.url === "/v2/beneficiaries/create") return form.get("iban") === "BAD" ? send(400, { error_code: "beneficiary_create_failed", error_messages: { iban: [{ message: "iban is invalid" }] } }) : send(200, { id: "ben-1" });
    if (rq.url === "/v2/conversions/create") return send(200, { id: "conv-1" });
    if (rq.url === "/v2/payments/create") return send(200, { id: "pay-1", status: "ready_to_send" });
    if (rq.url!.startsWith("/v2/funding_accounts/find")) return send(200, { funding_accounts: [{ id: "fa-1", account_holder_name: "CC", account_number: "123", routing_code: "SC1", routing_code_type: "sort_code", currency: "GBP" }] });
    send(404, {});
  });
  beforeAll(async () => { base = await s.start(); });
  afterAll(() => { s.server.close(); });
  const mk = () => new CurrencycloudClient({ baseUrl: base, loginId: "me", apiKey: "good" });

  it("authenticates once, sends X-Auth-Token, refreshes after a 401", async () => {
    const c = mk(); const b = logins;
    await c.detailedRate({ sellCurrency: "USD", buyCurrency: "EUR", sellAmount: "100.00" });
    await c.detailedRate({ sellCurrency: "USD", buyCurrency: "EUR", sellAmount: "100.00" });
    expect(logins - b).toBe(1);
    expire401 = true; await c.detailedRate({ sellCurrency: "USD", buyCurrency: "EUR", sellAmount: "1.00" });
    expect(logins - b).toBe(2);
  });
  it("bad credentials fail with AUTH_FAILED", async () => {
    await expect(new CurrencycloudClient({ baseUrl: base, loginId: "me", apiKey: "nope" }).detailedRate({ sellCurrency: "USD", buyCurrency: "EUR", sellAmount: "1" })).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });
  it("FX provider derives the net rate from the quoted amounts", async () => {
    const q = await new CurrencycloudFxProvider(mk()).quote({ sourceCurrency: "USD", destCurrency: "EUR", sourceAmountMinor: 10_000, destCountry: "DE" });
    expect(q.rate).toBeCloseTo(0.9, 6); expect(q.provider).toBe("currencycloud"); expect(q.rail).toBeTruthy();
    expect(new CurrencycloudFxProvider(mk()).supports("USD", "INR")).toBe(false);
  });
  it("the provider learns what the account can trade and refuses other pairs without calling the rate API", async () => {
    const fake = { currencies: async () => ({ currencies: [{ code: "USD" }, { code: "EUR" }, { code: "INR" }] }), detailedRate: async () => { throw new Error("must not be called"); } } as any;
    const p = new CurrencycloudFxProvider(fake);
    await expect(p.quote({ sourceCurrency: "USD", destCurrency: "CNH", sourceAmountMinor: 10_000, destCountry: "HK" })).rejects.toThrow(/cannot trade USD\/CNH/);
    expect(p.supports("USD", "EUR")).toBe(true); expect(p.supports("USD", "CNH")).toBe(false); expect(p.supports("USD", "INR")).toBe(false); // INR is always served by an Indian partner
  });
  it("the quote carries the provider's cut-off time", async () => {
    const fake = { currencies: async () => ({ currencies: [] }), detailedRate: async () => ({ client_rate: "0.9", client_buy_amount: "90.00", client_sell_amount: "100.00", settlement_cut_off_time: "2026-10-09T13:30:00Z" }) } as any;
    expect((await new CurrencycloudFxProvider(fake).quote({ sourceCurrency: "USD", destCurrency: "EUR", sourceAmountMinor: 10_000, destCountry: "DE" })).cutOffAt).toBe("2026-10-09T13:30:00Z");
  });
  it("payout = beneficiary + buy-side conversion + payment, with deterministic request ids", async () => {
    const p = new CurrencycloudPartner(mk(), "sek");
    const before = s.seen.length;
    expect((await p.createPayout(req())).partnerRef).toBe("pay-1");
    const calls = s.seen.slice(before).filter(x => x.url !== "/v2/authenticate/api");
    expect(calls.map(c => c.url)).toEqual(["/v2/beneficiaries/create", "/v2/conversions/create", "/v2/payments/create"]);
    const conv = new URLSearchParams(calls[1].body); expect(conv.get("fixed_side")).toBe("buy"); expect(conv.get("amount")).toBe("123.45");
    const pay = new URLSearchParams(calls[2].body); expect(pay.get("conversion_id")).toBe("conv-1"); expect(pay.get("unique_request_id")).toMatch(/^[0-9a-f]{40}$/);
    await p.createPayout(req());
    const again = s.seen.filter(x => x.url === "/v2/payments/create").map(x => new URLSearchParams(x.body).get("unique_request_id"));
    expect(new Set(again).size).toBe(1);
  });
  it("same-currency payout skips the conversion; missing bank details is refused", async () => {
    const p = new CurrencycloudPartner(mk(), "sek"); const before = s.seen.length;
    await p.createPayout(req({ route: route("EUR") }));
    expect(s.seen.slice(before).some(x => x.url === "/v2/conversions/create")).toBe(false);
    await expect(p.createPayout(req({ beneficiary: undefined }))).rejects.toThrow(/RECIPIENT_BANK_DETAILS_MISSING/);
  });
  it("provider rejections surface the field message and are permanent", async () => {
    const p = new CurrencycloudPartner(mk(), "sek");
    await expect(p.createPayout(req({ beneficiary: { accountName: "A", entityType: "PERSONAL", bankCountry: "DE", currency: "EUR", iban: "BAD" } }))).rejects.toMatchObject({ permanent: true, message: expect.stringContaining("iban is invalid") });
  });
  it("maps bank details to Currencycloud fields", () => {
    expect(ccBeneficiary({ accountName: "A", entityType: "PERSONAL", bankCountry: "GB", currency: "GBP", accountNumber: "1", sortCode: "12-34-56" })).toMatchObject({ routing_code_type_1: "sort_code", routing_code_value_1: "123456", beneficiary_entity_type: "individual" });
  });
  it("webhook: secret in the callback URL, constant-time; normalises payment events", () => {
    const p = new CurrencycloudPartner(mk(), "sek");
    expect(p.verifyWebhook("{}", new Headers(), new URL("https://x/api?s=sek"))).toBe(true);
    expect(p.verifyWebhook("{}", new Headers(), new URL("https://x/api?s=wrong"))).toBe(false);
    expect(p.verifyWebhook("{}", new Headers())).toBe(false);
    expect(new CurrencycloudPartner(mk(), undefined).verifyWebhook("{}", new Headers(), new URL("https://x/?s="))).toBe(false);
    expect(p.normalizeWebhook({ message_type: "payment", header: { message_id: "m1" }, body: { id: "pay-1", status: "completed" } })).toEqual({ id: "m1", type: "payout.completed", data: { transfer_ref: "pay-1" } });
    expect(p.normalizeWebhook({ message_type: "payment", body: { id: "pay-2", status: "failed", failure_reason: "closed account" } })).toMatchObject({ type: "payout.failed", data: { transfer_ref: "pay-2", reason: "closed account" } });
    expect(p.normalizeWebhook({ message_type: "payment", body: { id: "pay-3", status: "ready_to_send" } })).toBeNull();
    expect(p.normalizeWebhook({ message_type: "conversion", body: { id: "c" } })).toBeNull();
  });
  it("funding details come from the funding account", async () => {
    const f = await new CurrencycloudPartner(mk(), "sek").createFiatFunding({ transferId: "tr_9", currency: "GBP", amountMinor: 100n });
    expect(f.bankDetails.account_number).toBe("123"); expect(f.bankDetails.sort_code).toBe("SC1"); expect(f.reference).toBe("tr_9");
  });
});

describe("Wise adapter (contract test against a stub)", () => {
  let base = ""; let tokens = 0;
  const s = stub((rq, body, send) => {
    if (rq.url === "/oauth/token") { tokens++; return rq.headers.authorization === "Basic " + Buffer.from("cid:sec").toString("base64") ? send(200, { access_token: `w${tokens}`, expires_in: 3600 }) : send(401, { error: "invalid_client" }); }
    if (!String(rq.headers.authorization).startsWith("Bearer w")) return send(401, {});
    if (rq.url === "/v2/profiles") return send(200, [{ id: 11, type: "personal" }, { id: 22, type: "business" }]);
    if (rq.url === "/v3/profiles/22/quotes") { const b = JSON.parse(body); return send(200, { id: "qu-1", rate: 0.9, sourceAmount: b.sourceAmount ?? 137.17, targetAmount: b.targetAmount ?? 88, expirationTime: new Date(Date.now() + 30 * 60_000).toISOString(), paymentOptions: [{ payIn: "BANK_TRANSFER", sourceAmount: 100, targetAmount: 89 }, { payIn: "BALANCE", sourceAmount: 100, targetAmount: 87.5, fee: { total: 1.2 } }] }); }
    if (rq.url === "/v1/accounts") return send(200, { id: 777 });
    if (rq.url === "/v1/transfers") return send(200, { id: 9001, status: "incoming_payment_waiting" });
    if (rq.url === "/v3/profiles/22/transfers/9001/payments") return send(200, { status: "COMPLETED" });
    send(404, {});
  });
  beforeAll(async () => { base = await s.start(); });
  afterAll(() => { s.server.close(); });
  const mk = () => new WiseClient({ baseUrl: base, clientId: "cid", clientSecret: "sec" });

  it("uses client-credentials basic auth and picks the business profile", async () => {
    const c = mk(); expect(await c.profileId()).toBe("22");
    await expect(new WiseClient({ baseUrl: base, clientId: "cid", clientSecret: "bad" }).profileId()).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });
  it("FX provider quotes on the net BALANCE option (what the recipient receives)", async () => {
    const q = await new WiseFxProvider(mk()).quote({ sourceCurrency: "USD", destCurrency: "EUR", sourceAmountMinor: 10_000, destCountry: "DE" });
    expect(q.rate).toBeCloseTo(0.875, 6); expect(q.quoteId).toBe("qu-1"); expect(q.validUntil.getTime()).toBeGreaterThan(Date.now() + 60_000);
  });
  it("payout = target-amount quote + recipient + transfer + balance funding", async () => {
    const before = s.seen.length;
    const r = await new WisePartner(mk(), undefined).createPayout(req());
    expect(r.partnerRef).toBe("9001");
    const calls = s.seen.slice(before).map(c => c.url);
    expect(calls).toContain("/v1/accounts"); expect(calls.at(-1)).toBe("/v3/profiles/22/transfers/9001/payments");
    const quote = JSON.parse(s.seen.slice(before).find(c => c.url!.endsWith("/quotes"))!.body); expect(quote.targetAmount).toBe(123.45); expect(quote.sourceAmount).toBeUndefined();
    const acct = JSON.parse(s.seen.slice(before).find(c => c.url === "/v1/accounts")!.body); expect(acct).toMatchObject({ type: "iban", currency: "EUR", ownedByCustomer: false, details: { legalType: "BUSINESS", iban: "DE89370400440532013000" } });
    const tr = JSON.parse(s.seen.slice(before).find(c => c.url === "/v1/transfers")!.body); expect(tr.customerTransactionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("recipient mapping by bank-detail type; refuses when nothing usable", () => {
    expect(wiseRecipient({ accountName: "A", entityType: "PERSONAL", bankCountry: "GB", currency: "GBP", sortCode: "12-34-56", accountNumber: "1" }).type).toBe("sort_code");
    expect(wiseRecipient({ accountName: "A", entityType: "PERSONAL", bankCountry: "US", currency: "USD", routingNumber: "021000021", accountNumber: "1" }).type).toBe("aba");
    expect(() => wiseRecipient({ accountName: "A", entityType: "PERSONAL", bankCountry: "US", currency: "USD" })).toThrow(/RECIPIENT_BANK_DETAILS_MISSING/);
  });
  it("webhook: RSA-SHA256 signature over the raw body", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
    const body = JSON.stringify({ event_type: "transfers#state-change", data: { resource: { id: 9001 }, current_state: "outgoing_payment_sent" }, subscription_id: "s1" });
    const sig = createSign("RSA-SHA256").update(body).sign(privateKey, "base64");
    const p = new WisePartner(mk(), pem);
    expect(p.verifyWebhook(body, new Headers({ "x-signature-sha256": sig }))).toBe(true);
    expect(p.verifyWebhook(body + " ", new Headers({ "x-signature-sha256": sig }))).toBe(false);
    expect(p.verifyWebhook(body, new Headers())).toBe(false);
    expect(new WisePartner(mk(), undefined).verifyWebhook(body, new Headers({ "x-signature-sha256": sig }))).toBe(false);
    expect(p.normalizeWebhook(JSON.parse(body))).toEqual({ id: "s1:9001:outgoing_payment_sent", type: "payout.completed", data: { transfer_ref: "9001" } });
    expect(p.normalizeWebhook({ event_type: "transfers#state-change", data: { resource: { id: 5 }, current_state: "funds_refunded" } })).toMatchObject({ type: "payout.failed" });
    expect(p.normalizeWebhook({ event_type: "transfers#state-change", data: { resource: { id: 5 }, current_state: "processing" } })).toBeNull();
  });
});
