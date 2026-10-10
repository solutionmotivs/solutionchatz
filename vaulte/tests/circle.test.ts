import http from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CircleClient } from "../lib/psp/circle/client";
import { CirclePartner } from "../lib/psp/circle/partner";

describe("Circle Mint adapter (contract test against a local stub using the published request shapes)", () => {
  let server: http.Server; let base = ""; const seen: { method: string; url: string; auth?: string; body: any }[] = []; let flaky = 0;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let b = ""; req.on("data", c => (b += c));
      req.on("end", () => {
        const body = b ? JSON.parse(b) : {}; seen.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body });
        const send = (c: number, j: unknown) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
        if (req.url === "/ping") return send(200, { message: "pong" });
        if (req.headers.authorization !== "Bearer key") return send(401, { code: 401, message: "Invalid credentials" });
        if (req.url === "/v1/businessAccount/wallets/addresses/deposit") { if (flaky++ < 1) return send(503, {}); return send(200, { data: { id: "addr-1", address: "0xABC", addressTag: null, chain: body.chain, currency: body.currency } }); }
        if (req.url === "/v1/businessAccount/banks/wires/w1/instructions") return send(200, { data: { trackingRef: "CIR123456", beneficiary: { name: "Circle Internet Financial" }, beneficiaryBank: { name: "Bank X", swiftCode: "BANKUS33", routingNumber: "021000021", accountNumber: "1234", currency: "USD", country: "US" } } });
        if (req.url === "/v1/businessAccount/payouts" && req.method === "POST") return body.amount.currency === "JPY" ? send(400, { code: 2, message: "bad currency" }) : send(200, { data: { id: "po-1", status: "pending", amount: body.amount } });
        send(404, {});
      });
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server.close(); });
  const mk = (opts: any = {}) => new CirclePartner(new CircleClient({ baseUrl: base, apiKey: "key" }), { wireAccountId: "w1", destinations: { EUR: { type: "sepa_instant", id: "11111111-1111-4111-8111-111111111111" }, USD: { type: "wire", id: "22222222-2222-4222-8222-222222222222" } }, notifyEmail: "ops@vaulte.test", ...opts });

  it("ping works without a key; business paths refuse a wrong key", async () => {
    expect(await new CircleClient({ baseUrl: base, apiKey: "bad" }).ping()).toBe(true);
    await expect(new CircleClient({ baseUrl: base, apiKey: "bad" }).createDepositAddress({ currency: "USD", chain: "BASE" })).rejects.toMatchObject({ status: 401 });
  });
  it("EURC deposit: EUR on the right chain code, bearer auth, retried past a 503, idempotency key is a UUID and stable per transfer", async () => {
    const p = mk();
    const d = await p.createDeposit({ transferId: "t1", token: "EURC", chain: "base", expectedAmountMicro: 1_000_000_000n });
    expect(d).toMatchObject({ address: "0xABC", chain: "base", token: "EURC", partnerRef: "addr-1" });
    const calls = seen.filter(s => s.url === "/v1/businessAccount/wallets/addresses/deposit");
    expect(calls.at(-1)!.body).toMatchObject({ currency: "EUR", chain: "BASE" });
    expect(calls.at(-1)!.body.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    const again = await p.createDeposit({ transferId: "t1", token: "EURC", chain: "base", expectedAmountMicro: 1n });
    expect(seen.filter(s => s.url === "/v1/businessAccount/wallets/addresses/deposit").at(-1)!.body.idempotencyKey).toBe(calls.at(-1)!.body.idempotencyKey);
    expect(again.address).toBe("0xABC");
  });
  it("USDC maps to USD; unsupported tokens and chains are refused before any call", async () => {
    const p = mk();
    await p.createDeposit({ transferId: "t2", token: "USDC", chain: "solana", expectedAmountMicro: 1n });
    expect(seen.filter(s => s.url.endsWith("/deposit")).at(-1)!.body).toMatchObject({ currency: "USD", chain: "SOL" });
    await expect(p.createDeposit({ transferId: "t3", token: "USDT", chain: "tron", expectedAmountMicro: 1n })).rejects.toThrow(/does not handle USDT/);
    await expect(p.createDeposit({ transferId: "t4", token: "USDC", chain: "tron", expectedAmountMicro: 1n })).rejects.toThrow(/not offered on tron/);
  });
  it("fiat funding returns the wire details and the tracking reference to put in the memo", async () => {
    const f = await mk().createFiatFunding({ transferId: "t5", currency: "USD", amountMinor: 100000n });
    expect(f.reference).toBe("CIR123456"); expect(f.bankDetails).toMatchObject({ swift: "BANKUS33", account_number: "1234", tracking_reference: "CIR123456" });
    await expect(mk({ wireAccountId: undefined }).createFiatFunding({ transferId: "t6", currency: "USD", amountMinor: 1n })).rejects.toThrow(/CIRCLE_WIRE_ACCOUNT_ID/);
  });
  it("payout: SEPA Instant destination, decimal amount string, toAmount currency, beneficiary email; refuses unknown currency/destination", async () => {
    const r = await mk().createPayout({ transferId: "cl_abc-123", route: {} as any, destCurrency: "EUR", destAmountMinor: 123456n, recipientName: "X", recipientCountry: "FR" });
    expect(r.partnerRef).toBe("po-1");
    const call = seen.filter(s => s.url === "/v1/businessAccount/payouts").at(-1)!;
    expect(call.body).toMatchObject({ destination: { type: "sepa_instant" }, amount: { amount: "1234.56", currency: "EUR" }, toAmount: { currency: "EUR" }, metadata: { beneficiaryEmail: "ops@vaulte.test", customerExternalRef: "cl_abc-123".replace("_", "") } });
    await expect(mk().createPayout({ transferId: "t", route: {} as any, destCurrency: "JPY", destAmountMinor: 1000n, recipientName: "X", recipientCountry: "JP" })).rejects.toThrow(/only USD and EUR/);
    await expect(mk({ destinations: {} }).createPayout({ transferId: "t", route: {} as any, destCurrency: "EUR", destAmountMinor: 1000n, recipientName: "X", recipientCountry: "FR" })).rejects.toThrow(/No registered Circle payout destination/);
  });
  it("webhooks are refused until SNS verification exists; polling maps statuses to Vaulte events", () => {
    expect(mk().verifyWebhook()).toBe(false);
    expect(CirclePartner.eventForPayout("po-1", "complete")).toMatchObject({ type: "payout.completed" });
    expect(CirclePartner.eventForPayout("po-1", "failed", "bank_transaction_error")).toMatchObject({ type: "payout.failed", data: { reason: "bank_transaction_error" } });
    expect(CirclePartner.eventForPayout("po-1", "pending")).toBeNull();
  });
});
