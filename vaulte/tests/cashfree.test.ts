import http from "node:http";
import { AddressInfo } from "node:net";
import { createHmac, generateKeyPairSync, privateDecrypt, constants } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CashfreeClient, cashfreeFromEnv } from "../lib/psp/cashfree/client";
import { CashfreePartner, cashfreeTransfer, mapCashfreePayoutStatus } from "../lib/psp/cashfree/partner";
import type { PayoutRequest } from "../lib/psp/stablecoin/partner";

const req = (extra: Partial<PayoutRequest> = {}): PayoutRequest => ({
  transferId: "tr_cmabc123", route: { legs: [] } as never, destCurrency: "INR", destAmountMinor: 12_345_650n, recipientName: "Ravi Kumar", recipientCountry: "IN",
  invoiceNumber: "INV-2026/001", rail: "IMPS", beneficiary: { accountName: "Ravi Kumar & Sons", entityType: "COMPANY", bankCountry: "IN", currency: "INR", accountNumber: "026291800001191", ifsc: "yesb0000262" }, ...extra,
});

describe("Cashfree payout request", () => {
  it("builds an IMPS bank transfer with Indian-banking-safe text", () => {
    const t = cashfreeTransfer(req());
    expect(t).toMatchObject({ transfer_id: "tr_cmabc123", transfer_amount: 123456.5, transfer_currency: "INR", transfer_mode: "imps", transfer_remarks: "Vaulte INV 2026 001" });
    expect(t.beneficiary_details).toEqual({ beneficiary_name: "Ravi Kumar Sons", beneficiary_instrument_details: { bank_account_number: "026291800001191", bank_ifsc: "YESB0000262" } });
  });
  it("maps rails: NEFT/RTGS direct, anything else banktransfer, UPI only with a UPI ID", () => {
    expect(cashfreeTransfer(req({ rail: "NEFT" })).transfer_mode).toBe("neft");
    expect(cashfreeTransfer(req({ rail: "RTGS" })).transfer_mode).toBe("rtgs");
    expect(cashfreeTransfer(req({ rail: undefined })).transfer_mode).toBe("banktransfer");
    const upi = cashfreeTransfer(req({ rail: "UPI", beneficiary: { ...req().beneficiary!, upiId: "ravi@okhdfcbank", accountNumber: undefined, ifsc: undefined } }));
    expect(upi.transfer_mode).toBe("upi");
    expect(upi.beneficiary_details.beneficiary_instrument_details).toEqual({ vpa: "ravi@okhdfcbank" });
    expect(() => cashfreeTransfer(req({ rail: "UPI", beneficiary: { ...req().beneficiary!, accountNumber: undefined, ifsc: undefined } }))).toThrow(/UPI ID/);
  });
  it("refuses what Cashfree cannot pay", () => {
    expect(() => cashfreeTransfer(req({ beneficiary: undefined }))).toThrow(/RECIPIENT_BANK_DETAILS_MISSING/);
    expect(() => cashfreeTransfer(req({ destCurrency: "USD" }))).toThrow(/INR only/);
    expect(() => cashfreeTransfer(req({ beneficiary: { ...req().beneficiary!, ifsc: undefined } }))).toThrow(/IFSC/);
  });
});

describe("Cashfree statuses and webhooks", () => {
  it("maps payout statuses", () => {
    expect(mapCashfreePayoutStatus("SUCCESS")).toEqual({ state: "PAID" });
    for (const s of ["FAILED", "REJECTED", "REVERSED"]) expect(mapCashfreePayoutStatus(s, "bank said no")).toMatchObject({ state: "FAILED" });
    for (const s of ["RECEIVED", "APPROVAL_PENDING", "PENDING"]) expect(mapCashfreePayoutStatus(s)).toEqual({ state: "PENDING" });
  });
  const partner = new CashfreePartner(new CashfreeClient({ baseUrl: "http://x", clientId: "CF1", clientSecret: "cfsk_ma_test_secret", apiVersion: "2024-01-01" }));
  it("verifies the V2 signature and refuses stale or tampered ones", () => {
    const body = JSON.stringify({ type: "TRANSFER_SUCCESS", data: { transfer_id: "tr_1", status: "SUCCESS" } });
    const ts = String(Date.now());
    const sig = createHmac("sha256", "cfsk_ma_test_secret").update(ts + body).digest("base64");
    expect(partner.verifyWebhook(body, new Headers({ "x-webhook-signature": sig, "x-webhook-timestamp": ts }))).toBe(true);
    expect(partner.verifyWebhook(body + " ", new Headers({ "x-webhook-signature": sig, "x-webhook-timestamp": ts }))).toBe(false);
    const old = String(Date.now() - 3 * 3600_000), oldSig = createHmac("sha256", "cfsk_ma_test_secret").update(old + body).digest("base64");
    expect(partner.verifyWebhook(body, new Headers({ "x-webhook-signature": oldSig, "x-webhook-timestamp": old }))).toBe(false);
    expect(partner.verifyWebhook(body, new Headers())).toBe(false);
  });
  it("turns transfer events into deterministic payout events", () => {
    expect(partner.normalizeWebhook({ type: "TRANSFER_SUCCESS", data: { transfer_id: "tr_1", status: "SUCCESS", transfer_utr: "UTR9" } })).toEqual({ id: "payout:tr_1:paid", type: "payout.completed", data: { transfer_ref: "tr_1", utr: "UTR9" } });
    expect(partner.normalizeWebhook({ type: "TRANSFER_REVERSED", data: { transfer_id: "tr_1", status: "REVERSED", status_description: "beneficiary account closed" } })).toMatchObject({ id: "payout:tr_1:failed", type: "payout.failed" });
    expect(partner.normalizeWebhook({ type: "TRANSFER_ACKNOWLEDGED", data: { transfer_id: "tr_1", status: "RECEIVED" } })).toBeNull();
    expect(partner.normalizeWebhook({ type: "BENEFICIARY_X", data: {} })).toBeNull();
  });
});

describe("Cashfree client against a stub", () => {
  const calls: { method: string; url: string; headers: http.IncomingHttpHeaders; body: any }[] = [];
  let server: http.Server, base = "";
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  beforeAll(async () => {
    server = http.createServer((rq, rs) => {
      let raw = ""; rq.on("data", c => (raw += c)); rq.on("end", () => {
        const body = raw ? JSON.parse(raw) : undefined; calls.push({ method: rq.method!, url: rq.url!, headers: rq.headers, body });
        rs.setHeader("content-type", "application/json");
        if (rq.url!.startsWith("/transfers") && rq.method === "POST") return rs.end(JSON.stringify({ transfer_id: body.transfer_id, status: "RECEIVED", cf_transfer_id: "9" }));
        if (rq.url!.startsWith("/transfers")) return rs.end(JSON.stringify({ transfer_id: "tr_cmabc123", status: "SUCCESS", transfer_utr: "UTR1" }));
        if (rq.url!.startsWith("/beneficiary")) { rs.statusCode = 404; return rs.end(JSON.stringify({ type: "invalid_request_error", code: "beneficiary_not_found", message: "Beneficiary not found" })); }
        rs.statusCode = 403; rs.end(JSON.stringify({ type: "authentication_error", message: "IP not whitelisted" }));
      });
    });
    await new Promise<void>(r => server.listen(0, r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server.close(); });

  it("sends credentials, version and an RSA-OAEP signature the holder of the private key can read", async () => {
    const client = new CashfreeClient({ baseUrl: base, clientId: "CF1", clientSecret: "S", apiVersion: "2024-01-01", publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() });
    const p = new CashfreePartner(client);
    const out = await p.createPayout(req());
    expect(out.partnerRef).toBe("tr_cmabc123");
    const c = calls.at(-1)!;
    expect(c.headers).toMatchObject({ "x-client-id": "CF1", "x-client-secret": "S", "x-api-version": "2024-01-01" });
    expect(c.headers["x-request-id"]).toBe("tr_cmabc123");
    const plain = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" }, Buffer.from(String(c.headers["x-cf-signature"]), "base64")).toString();
    expect(plain).toMatch(/^CF1\.\d{10}$/);
    expect(await p.getPayoutStatus("tr_cmabc123")).toEqual({ state: "PAID" });
    expect(await client.ping()).toBe(true); // a 404 for the probe beneficiary still proves the keys were accepted
  });
  it("sends no signature without a key, and reports a whitelist refusal clearly", async () => {
    const client = new CashfreeClient({ baseUrl: base, clientId: "CF1", clientSecret: "S", apiVersion: "2024-01-01" });
    expect(client.signature()).toBeNull();
    await expect(client.call("GET", "/something")).rejects.toThrow(/IP not whitelisted/);
  });
  it("picks sandbox or production from the environment and needs both keys", () => {
    expect(cashfreeFromEnv({} as never)).toBeNull();
    expect(cashfreeFromEnv({ CASHFREE_CLIENT_ID: "a", CASHFREE_CLIENT_SECRET: "b" } as never)!.isSandbox).toBe(true);
    expect(cashfreeFromEnv({ CASHFREE_CLIENT_ID: "a", CASHFREE_CLIENT_SECRET: "b", CASHFREE_ENV: "production" } as never)!.isSandbox).toBe(false);
  });
});
