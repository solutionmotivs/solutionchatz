import http from "node:http";
import { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AirwallexClient, AirwallexError, requestId } from "../lib/psp/airwallex/client";
import { AirwallexPartner, bankDetailsFor } from "../lib/psp/airwallex/partner";
import { AirwallexFxProvider } from "../lib/fx/providers/airwallex";
import { MockFxDesk } from "../lib/fx/providers/mock";
import { buildLiveLegs, spreadBpsVsMid, summariseFx } from "../lib/fx/aggregator";
import type { FxProvider } from "../lib/fx/providers/types";
import { findRoutes, rankRoutes } from "../lib/routing/engine";
import { localRailFor, railEta, RAILS } from "../lib/routing/rails";
import type { Route } from "../lib/stablecoin/types";

describe("Airwallex client (contract test against a local stub)", () => {
  let server: http.Server; let base = "";
  const seen: { method: string; url: string; headers: http.IncomingHttpHeaders; body: any }[] = [];
  let logins = 0; let failNext401 = false; let flaky = 0;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let b = ""; req.on("data", c => (b += c));
      req.on("end", () => {
        const body = b ? JSON.parse(b) : null;
        seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
        const send = (code: number, json: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(json)); };
        if (req.url === "/api/v1/authentication/login") {
          logins++;
          return req.headers["x-api-key"] === "good" && req.headers["x-client-id"] === "cid" ? send(201, { token: `tok${logins}`, expires_at: new Date(Date.now() + 30 * 60_000).toISOString() }) : send(401, { code: "credentials_invalid", message: "bad" });
        }
        if (!String(req.headers.authorization).startsWith("Bearer tok")) return send(401, { code: "unauthorized" });
        if (failNext401) { failNext401 = false; return send(401, { code: "token_expired" }); }
        if (req.url === "/api/v1/fx/quotes/create") return send(201, { quote_id: "q-1", client_rate: "0.9215", currency_pair: "USDEUR", sell_amount: body.sell_amount, buy_amount: String((Number(body.sell_amount) * 0.9215).toFixed(2)), valid_to_at: new Date(Date.now() + 15 * 60_000).toISOString() });
        if (req.url === "/api/v1/beneficiaries/create") return body.beneficiary.bank_details.iban === "BAD" ? send(400, { code: "validation_failed", message: "iban invalid", source: "beneficiary.bank_details.iban" }) : send(201, { id: "ben-1" });
        if (req.url === "/api/v1/transfers/create") { if (flaky++ < 1) return send(503, { code: "unavailable" }); return send(201, { id: "tr-1", status: "SCHEDULED" }); }
        if (req.url === "/api/v1/global_accounts/create") return send(201, { id: "ga-1", account_name: "VAULTE CUSTOMER", iban: "GB00TEST00000000000001", institution: { name: "Test Bank" } });
        send(404, { code: "not_found" });
      });
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server.close(); });
  const mk = (extra = {}) => new AirwallexClient({ baseUrl: base, clientId: "cid", apiKey: "good", ...extra });

  it("logs in once with client id + api key and reuses the token", async () => {
    const c = mk(); const before = logins;
    await c.createFxQuote({ sellCurrency: "USD", buyCurrency: "EUR", sellAmount: "100.00" });
    await c.createFxQuote({ sellCurrency: "USD", buyCurrency: "EUR", sellAmount: "200.00" });
    expect(logins - before).toBe(1);
    const q = seen.filter(s => s.url === "/api/v1/fx/quotes/create").at(-2)!;
    expect(q.headers.authorization).toMatch(/^Bearer tok/);
    expect(q.body).toEqual({ sell_currency: "USD", buy_currency: "EUR", sell_amount: "100.00", validity: "MIN_15" });
  });
  it("re-authenticates when a token is rejected mid-flight", async () => {
    const c = mk(); await c.createFxQuote({ sellCurrency: "USD", buyCurrency: "EUR", sellAmount: "1" });
    const before = logins; failNext401 = true;
    const r = await c.createFxQuote({ sellCurrency: "USD", buyCurrency: "EUR", sellAmount: "1" });
    expect(r.quote_id).toBe("q-1"); expect(logins - before).toBe(1);
  });
  it("bad credentials raise AUTH_FAILED", async () => {
    await expect(new AirwallexClient({ baseUrl: base, clientId: "cid", apiKey: "nope" }).createFxQuote({ sellCurrency: "USD", buyCurrency: "EUR", sellAmount: "1" })).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });
  it("sends x-on-behalf-of for connected accounts", async () => {
    await mk({ onBehalfOf: "acct_123" }).createFxQuote({ sellCurrency: "USD", buyCurrency: "EUR", sellAmount: "5" });
    expect(seen.filter(s => s.url === "/api/v1/fx/quotes/create").at(-1)!.headers["x-on-behalf-of"]).toBe("acct_123");
  });
  it("4xx is a permanent error with Airwallex's code and source", async () => {
    const e = await mk().createBeneficiary({ requestId: requestId("b", "1"), entityType: "COMPANY", name: "ACME GMBH", bank: { account_name: "ACME GMBH", account_currency: "EUR", bank_country_code: "DE", iban: "BAD" }, methods: ["LOCAL"] }).catch(x => x);
    expect(e).toBeInstanceOf(AirwallexError);
    expect(e).toMatchObject({ status: 400, code: "validation_failed", permanent: true, source: "beneficiary.bank_details.iban" });
  });
  it("5xx on a POST is retried with the same request_id (safe: Airwallex de-duplicates)", async () => {
    flaky = 0; const rid = requestId("transfer", "T1");
    const t = await mk().createTransfer({ requestId: rid, beneficiaryId: "ben-1", sourceCurrency: "USD", transferCurrency: "EUR", transferAmount: "100.00", method: "LOCAL", reason: "professional_business_services", reference: "INV-1", quoteId: "q-1" });
    expect(t.id).toBe("tr-1");
    const calls = seen.filter(s => s.url === "/api/v1/transfers/create").slice(-2);
    expect(calls).toHaveLength(2);
    expect(calls[0].body.request_id).toBe(rid); expect(calls[1].body.request_id).toBe(rid);
    expect(calls[1].body).toMatchObject({ beneficiary_id: "ben-1", quote_id: "q-1", lock_rate_on_create: true, transfer_method: "LOCAL", fee_paid_by: "PAYER" });
  });
  it("request ids are deterministic UUIDs", () => {
    expect(requestId("a", "b")).toBe(requestId("a", "b"));
    expect(requestId("a", "b")).not.toBe(requestId("a", "c"));
    expect(requestId("x")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("partner: creates the beneficiary then the transfer, locking the quoted rate", async () => {
    flaky = 5;
    const p = new AirwallexPartner(mk(), "whsec");
    const route = { legs: [{ id: "airwallex.direct.USDEUR", partner: "airwallex", rails: ["SEPA_INSTANT"], srcCurrency: "USD", live: { provider: "airwallex", quoteId: "q-9", rate: 0.92, midRate: 0.93, validUntil: "2099-01-01" } }] } as unknown as Route;
    const r = await p.createPayout({ transferId: "T2", route, destCurrency: "EUR", destAmountMinor: 92000n, recipientName: "Acme", recipientCountry: "DE", invoiceNumber: "INV-2", beneficiary: { accountName: "ACME GMBH", entityType: "COMPANY", bankCountry: "DE", currency: "EUR", iban: "DE89370400440532013000" } });
    expect(r.partnerRef).toBe("tr-1");
    const tr = seen.filter(s => s.url === "/api/v1/transfers/create").at(-1)!;
    expect(tr.body).toMatchObject({ quote_id: "q-9", transfer_amount: "920.00", transfer_currency: "EUR", source_currency: "USD", transfer_method: "LOCAL", reference: "INV-2" });
    const ben = seen.filter(s => s.url === "/api/v1/beneficiaries/create").at(-1)!;
    expect(ben.body.beneficiary).toMatchObject({ entity_type: "COMPANY", company_name: "ACME GMBH", bank_details: { iban: "DE89370400440532013000" } });
  });
  it("partner refuses to pay out without bank details", async () => {
    const p = new AirwallexPartner(mk(), "s");
    await expect(p.createPayout({ transferId: "T3", route: { legs: [{ rails: ["SWIFT"] }] } as unknown as Route, destCurrency: "EUR", destAmountMinor: 100n, recipientName: "x", recipientCountry: "DE" })).rejects.toThrow(/RECIPIENT_BANK_DETAILS_MISSING/);
  });
  it("partner: funding and virtual account come from a global account", async () => {
    const p = new AirwallexPartner(mk(), "s");
    const f = await p.createFiatFunding({ transferId: "T4", currency: "EUR", amountMinor: 100n });
    expect(f.bankDetails.iban).toBe("GB00TEST00000000000001");
    const v = await p.createVirtualAccount({ entityId: "E1", legalName: "Acme", country: "DE", currency: "EUR" });
    expect(v.partnerRef).toBe("ga-1");
  });
  it("bank details map to Airwallex routing types", () => {
    expect(bankDetailsFor({ accountName: "A", entityType: "COMPANY", bankCountry: "US", currency: "USD", routingNumber: "021000021", accountNumber: "1234" }).bank).toMatchObject({ account_routing_type1: "aba", account_routing_value1: "021000021", account_number: "1234" });
    expect(bankDetailsFor({ accountName: "A", entityType: "PERSONAL", bankCountry: "GB", currency: "GBP", sortCode: "20-00-00", accountNumber: "55779911" }).bank).toMatchObject({ account_routing_type1: "sort_code", account_routing_value1: "200000" });
  });
});

describe("Airwallex webhooks", () => {
  const p = new AirwallexPartner(new AirwallexClient({ baseUrl: "http://x", clientId: "c", apiKey: "k" }), "whsec_test");
  const sign = (ts: string, body: string, secret = "whsec_test") => createHmac("sha256", secret).update(ts + body).digest("hex");
  const hdr = (ts: string, sig: string) => new Headers({ "x-timestamp": ts, "x-signature": sig });
  it("accepts a correctly signed, fresh delivery", () => {
    const body = '{"id":"e1","name":"payout.transfer.paid","data":{"id":"tr-1"}}'; const ts = String(Date.now());
    expect(p.verifyWebhook(body, hdr(ts, sign(ts, body)))).toBe(true);
  });
  it("rejects a wrong signature, a tampered body, a stale timestamp and a missing secret", () => {
    const body = '{"a":1}'; const ts = String(Date.now());
    expect(p.verifyWebhook(body, hdr(ts, sign(ts, body, "other")))).toBe(false);
    expect(p.verifyWebhook(body + " ", hdr(ts, sign(ts, body)))).toBe(false);
    const old = String(Date.now() - 6 * 60_000);
    expect(p.verifyWebhook(body, hdr(old, sign(old, body)))).toBe(false);
    expect(new AirwallexPartner(new AirwallexClient({ baseUrl: "http://x", clientId: "c", apiKey: "k" }), undefined).verifyWebhook(body, hdr(ts, sign(ts, body)))).toBe(false);
  });
  it("maps transfer outcomes to Vaulte events and ignores the rest", () => {
    expect(p.normalizeWebhook({ id: "e1", name: "payout.transfer.paid", data: { id: "tr-1", status: "PAID" } })).toMatchObject({ type: "payout.completed", data: { transfer_ref: "tr-1" } });
    expect(p.normalizeWebhook({ id: "e2", name: "payout.transfer.failed", data: { id: "tr-2", failure_reason: "invalid account" } })).toMatchObject({ type: "payout.failed", data: { transfer_ref: "tr-2", reason: "invalid account" } });
    expect(p.normalizeWebhook({ id: "e3", name: "account.updated", data: {} })).toBeNull();
    expect(p.normalizeWebhook({ nonsense: true })).toBeNull();
  });
});

describe("FX providers and aggregator", () => {
  it("Airwallex provider derives the rate from buy/sell amounts, falling back to the pair orientation", async () => {
    const mkp = (resp: any) => new AirwallexFxProvider({ createFxQuote: async () => resp } as any);
    const a = await mkp({ quote_id: "q", sell_amount: "1000", buy_amount: "921.50" }).quote({ sourceCurrency: "USD", destCurrency: "EUR", sourceAmountMinor: 100000, destCountry: "DE" }, { destPerSource: 0.93, usdPerSource: 1 });
    expect(a.rate).toBeCloseTo(0.9215, 6); expect(a.rail).toBe("SEPA_INSTANT"); expect(a.quoteId).toBe("q");
    const b = await mkp({ quote_id: "q", client_rate: "1.085", currency_pair: "EURUSD" }).quote({ sourceCurrency: "USD", destCurrency: "EUR", sourceAmountMinor: 100000, destCountry: "DE" }, { destPerSource: 0.93, usdPerSource: 1 });
    expect(b.rate).toBeCloseTo(1 / 1.085, 6);
    const swift = await mkp({ quote_id: "q", sell_amount: "10", buy_amount: "9" }).quote({ sourceCurrency: "USD", destCurrency: "AED", sourceAmountMinor: 1000, destCountry: "AE" }, { destPerSource: 3.67, usdPerSource: 1 });
    expect(swift.rail).toBe("UAEFTS");
    await expect(mkp({ quote_id: "q" }).quote({ sourceCurrency: "USD", destCurrency: "EUR", sourceAmountMinor: 100, destCountry: "DE" }, { destPerSource: 1, usdPerSource: 1 })).rejects.toThrow(/usable rate/);
  });
  const args = (over: Record<string, unknown> = {}) => ({ kind: "BUSINESS" as const, originCountry: "US", destCountry: "DE", sourceCurrency: "USD", destCurrency: "EUR", sourceAmountMinor: 500_000, sourceAmountUsd: 5000, midDestPerSource: 0.92, fundingMethod: "FIAT_LOCAL", providers: [new MockFxDesk("a", 28, 0), new MockFxDesk("b", 19, 1), new MockFxDesk("c", 35, 0)], ...over });
  const cheapest = async (a: ReturnType<typeof args>) => {
    const live = await buildLiveLegs(a);
    const routes = findRoutes({ kind: a.kind, originCountry: a.originCountry, destCountry: a.destCountry, sourceCurrency: a.sourceCurrency, destCurrency: a.destCurrency, amountUsd: a.sourceAmountUsd, fundingMethod: "FIAT_LOCAL" as any }, { legs: live.legs });
    return { live, best: rankRoutes(routes, a.sourceAmountUsd, "cheapest")[0] };
  };
  it("computes spread against mid", () => {
    expect(spreadBpsVsMid(0.9, 1)).toBe(1000); expect(spreadBpsVsMid(1.01, 1)).toBe(0); expect(spreadBpsVsMid(1, 0)).toBe(0);
  });
  it("collects one leg per provider and picks the cheapest landed cost (fee vs spread depends on the amount)", async () => {
    const big = await cheapest(args());
    expect(big.live.legs).toHaveLength(3);
    expect(big.best.legs[0].partner).toBe("b"); // 19 bps + $1 beats 28 bps at $5,000
    const small = await cheapest(args({ sourceAmountMinor: 10_000, sourceAmountUsd: 100 }));
    expect(small.best.legs[0].partner).toBe("a"); // at $100 the $1 fee dominates
  });
  it("records the comparison with the winner flagged", async () => {
    const { live, best } = await cheapest(args());
    const fx = summariseFx(best.legs.find(l => l.live), live, 5000)!;
    expect(fx.provider).toBe("b"); expect(fx.compared).toHaveLength(3);
    expect(fx.compared.filter(c => c.chosen).map(c => c.provider)).toEqual(["b"]);
    expect(fx.compared[0].provider).toBe("b"); expect(fx.spread_bps).toBeCloseTo(19, 1); expect(fx.rail).toBe("SEPA_INSTANT");
  });
  it("a failing or slow provider does not break quoting", async () => {
    const boom: FxProvider = { id: "boom", supports: () => true, quote: async () => { throw new Error("upstream 500"); } };
    const slow: FxProvider = { id: "slow", supports: () => true, quote: () => new Promise(() => {}) };
    const live = await buildLiveLegs(args({ providers: [boom, slow, new MockFxDesk("a", 28, 0)], timeoutMs: 100 }));
    expect(live.legs.map(l => l.partner)).toEqual(["a"]);
    expect(live.errors.map(e => e.provider).sort()).toEqual(["boom", "slow"]);
  });
  it("rejects quotes that are unusable or about to expire", async () => {
    const stale: FxProvider = { id: "stale", supports: () => true, quote: async () => ({ provider: "stale", rate: 0.9, validUntil: new Date(Date.now() + 10_000), fixedFeeUsd: 0, feeBps: 0, rail: "SWIFT", etaSec: 1, minUsd: 1, maxUsd: 1e6, jurisdiction: "UK", country: "GB" }) };
    const live = await buildLiveLegs(args({ providers: [stale] }));
    expect(live.legs).toEqual([]); expect(live.errors[0].provider).toBe("stale");
  });
  it("never prices India corridors or stablecoin funding through general FX providers", async () => {
    expect((await buildLiveLegs(args({ destCountry: "IN", destCurrency: "INR" }))).legs).toEqual([]);
    expect((await buildLiveLegs(args({ originCountry: "IN", sourceCurrency: "INR" }))).legs).toEqual([]);
    expect((await buildLiveLegs(args({ fundingMethod: "STABLECOIN" }))).legs).toEqual([]);
    expect((await buildLiveLegs(args({ destCurrency: "USD" }))).legs).toEqual([]); // same currency
  });
  it("direct legs are not used when funding with stablecoin", () => {
    const routes = findRoutes({ kind: "BUSINESS", originCountry: "US", destCountry: "US", sourceCurrency: "USD", destCurrency: "USD", amountUsd: 1000, fundingMethod: "STABLECOIN" });
    expect(routes.every(r => r.legs.every(l => l.kind !== "DIRECT"))).toBe(true);
  });
});

describe("rails", () => {
  it("prefers a local rail where one exists and SWIFT otherwise", () => {
    expect(localRailFor("EUR", "DE")).toBe("SEPA_INSTANT");
    expect(localRailFor("EUR", "US")).toBeNull();
    expect(localRailFor("GBP", "GB")).toBe("FASTER_PAYMENTS");
    expect(localRailFor("USD", "US")).toBe("ACH_SAME_DAY");
    expect(localRailFor("USD", "US", { urgent: true })).toBe("FEDNOW");
    expect(localRailFor("SGD", "SG")).toBe("FAST");
    expect(localRailFor("BRL", "BR")).toBeNull();
  });
  it("instant rails are minutes, SWIFT is about a day", () => {
    expect(railEta("SEPA_INSTANT")).toBeLessThan(60);
    expect(railEta("FEDNOW")).toBeLessThan(60);
    expect(railEta("SWIFT")).toBeGreaterThan(3600);
    expect(RAILS.FEDNOW.alwaysOn).toBe(true);
  });
});
