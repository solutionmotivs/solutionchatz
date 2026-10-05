import http from "node:http";
import { AddressInfo } from "node:net";
import { XMLParser } from "fast-xml-parser";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildVoucher, homeCurrency, perspectiveFor, voucherBalanced, type TransferForVoucher } from "../lib/erp/vouchers";
import { tallyXml } from "../lib/erp/tally";
import { ErpAuthError, quickbooks, xero, zoho } from "../lib/erp/connectors";
import { readState, signState } from "../lib/erp/sync";
import { EVENT_NAMES, EVENTS } from "../lib/events/catalogue";
import { WebhookEventType } from "@prisma/client";
import { toEventEnum } from "../lib/webhooks/dispatch";

const T = (over: Partial<TransferForVoucher> = {}): TransferForVoucher => ({
  id: "cmtransfer0001", completedAt: new Date("2026-10-05T10:00:00Z"), createdAt: new Date("2026-10-05T09:00:00Z"), sourceCurrency: "USD", destCurrency: "INR",
  sourceAmount: 500_000n, destAmount: 41_000_000n, sourceAmountUsd: 500_000n, partnerCostUsd: 1_800n, markupUsd: 1_500n, externalRef: "PARTNER-1", originCountry: "US", destCountry: "IN",
  fundingMethod: "FIAT_LOCAL", senderName: "Acme Inc & Sons <US>", recipientName: "Alpha Exports Pvt Ltd", invoiceNumber: "INV-1", ...over,
});

describe("accounting vouchers", () => {
  it("a receipt books bank, charges and the counterparty, and balances", () => {
    const v = buildVoucher(T(), "RECEIPT");
    expect(v.currency).toBe("INR"); expect(v.type).toBe("RECEIPT"); expect(v.party).toContain("Acme");
    expect(voucherBalanced(v)).toBe(true);
    expect(v.lines.find(l => l.role === "BANK")).toMatchObject({ side: "DEBIT", amountMinor: 41_000_000n });
    const charges = v.lines.find(l => l.role === "CHARGES")!;
    // fees USD 33.00 on a net USD 4,967.00 that became INR 410,000.00: charges = 33/4967 * 410000.00 = INR 2,723.98
    expect(Number(charges.amountMinor)).toBe(272_398);
    expect(v.lines.find(l => l.role === "PARTY")).toMatchObject({ side: "CREDIT", amountMinor: 41_000_000n + charges.amountMinor });
  });
  it("a payment books the supplier, charges and the bank in the sender's currency, and balances", () => {
    const v = buildVoucher(T({ sourceCurrency: "EUR", sourceAmount: 460_000n }), "PAYMENT");
    expect(v.currency).toBe("EUR"); expect(v.party).toBe("Alpha Exports Pvt Ltd"); expect(voucherBalanced(v)).toBe(true);
    expect(v.lines.find(l => l.role === "BANK")).toMatchObject({ side: "CREDIT", amountMinor: 460_000n });
    expect(v.lines.find(l => l.role === "CHARGES")!.amountMinor + v.lines.find(l => l.role === "PARTY")!.amountMinor).toBe(460_000n);
  });
  it("zero fees produce a two-line voucher; every voucher id is stable (idempotency key)", () => {
    const v = buildVoucher(T({ partnerCostUsd: 0n, markupUsd: 0n }), "RECEIPT");
    expect(v.lines).toHaveLength(2); expect(voucherBalanced(v)).toBe(true);
    expect(buildVoucher(T(), "RECEIPT").id).toBe(buildVoucher(T(), "RECEIPT").id);
  });
  it("perspective: money arriving in your country is a receipt; virtual accounts are always receipts; override wins", () => {
    expect(perspectiveFor(T(), "IN")).toBe("RECEIPT");
    expect(perspectiveFor(T(), "US")).toBe("PAYMENT");
    expect(perspectiveFor(T({ fundingMethod: "VIRTUAL_ACCOUNT", originCountry: "IN" }), "US")).toBe("RECEIPT");
    expect(perspectiveFor(T(), "IN", "PAYMENT")).toBe("PAYMENT");
    expect(homeCurrency("IN")).toBe("INR"); expect(homeCurrency("DE")).toBe("EUR"); expect(homeCurrency("BR")).toBe("USD");
  });
});

describe("Tally XML", () => {
  const xml = tallyXml([buildVoucher(T(), "RECEIPT"), buildVoucher(T({ id: "cmtransfer0002", sourceCurrency: "INR", sourceAmount: 4_100_000n, originCountry: "IN", destCountry: "US", destCurrency: "USD", destAmount: 49_000n }), "PAYMENT")], { bank: "HDFC Bank", company: "Alpha Pvt Ltd & Co" });
  const doc = new XMLParser({ ignoreAttributes: false, isArray: n => ["TALLYMESSAGE", "ALLLEDGERENTRIES.LIST"].includes(n) }).parse(xml);
  it("is well-formed with the import envelope and company", () => {
    expect(doc.ENVELOPE.HEADER.TALLYREQUEST).toBe("Import Data");
    expect(doc.ENVELOPE.BODY.IMPORTDATA.REQUESTDESC.STATICVARIABLES.SVCURRENTCOMPANY).toBe("Alpha Pvt Ltd & Co");
  });
  it("escapes party names and uses Tally's sign convention (debit = Yes and negative; credit = No and positive)", () => {
    expect(xml).toContain("Acme Inc &amp; Sons &lt;US&gt;");
    const msgs = doc.ENVELOPE.BODY.IMPORTDATA.REQUESTDATA.TALLYMESSAGE;
    const receipt = msgs.find((m: any) => m.VOUCHER?.["@_VCHTYPE"] === "Receipt").VOUCHER;
    const entries = receipt["ALLLEDGERENTRIES.LIST"];
    const bank = entries.find((e: any) => e.LEDGERNAME === "HDFC Bank");
    expect(bank.ISDEEMEDPOSITIVE).toBe("Yes"); expect(Number(bank.AMOUNT)).toBe(-410000);
    const party = entries.find((e: any) => e.LEDGERNAME.startsWith("Acme"));
    expect(party.ISDEEMEDPOSITIVE).toBe("No"); expect(Number(party.AMOUNT)).toBeGreaterThan(410000);
    expect(entries.reduce((s: number, e: any) => s + Number(e.AMOUNT), 0)).toBeCloseTo(0, 2);
    expect(String(receipt.DATE)).toBe("20261005");
  });
  it("creates missing ledgers under the right groups unless disabled", () => {
    expect(xml).toMatch(/<LEDGER NAME="Acme Inc &amp; Sons &lt;US&gt;" ACTION="Create"><NAME>[^<]+<\/NAME><PARENT>Sundry Debtors<\/PARENT>/);
    expect(xml).toMatch(/<LEDGER NAME="Alpha Exports Pvt Ltd" ACTION="Create"><NAME>[^<]+<\/NAME><PARENT>Sundry Creditors<\/PARENT>/);
    expect(xml).toMatch(/Bank Charges<\/NAME><PARENT>Indirect Expenses/);
    expect(tallyXml([buildVoucher(T(), "RECEIPT")], { create_masters: false })).not.toContain("<LEDGER ");
  });
  it("strips control characters that would make Tally reject the file", () => {
    expect(tallyXml([buildVoucher(T({ senderName: "Bad\u0001Name" }), "RECEIPT")])).not.toMatch(/\u0001/);
  });
});

describe("OAuth state", () => {
  it("round-trips and binds org, user and provider", () => {
    const s = signState({ org: "o1", user: "u1", provider: "XERO" });
    expect(readState(s)).toMatchObject({ org: "o1", user: "u1", provider: "XERO" });
  });
  it("rejects tampering and garbage", () => {
    const s = signState({ org: "o1", user: "u1", provider: "XERO" });
    const [b, sig] = s.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b, "base64url").toString()), org: "evil" })).toString("base64url");
    expect(readState(`${forged}.${sig}`)).toBeNull(); expect(readState("x.y")).toBeNull(); expect(readState("")).toBeNull();
  });
});

describe("event catalogue", () => {
  it("every catalogue event maps to a real database enum value (a bad name would fail a financial transaction)", () => {
    const valid = Object.values(WebhookEventType) as string[];
    for (const name of EVENT_NAMES) expect(valid, name).toContain(toEventEnum(name));
    expect(toEventEnum("ledger.journal.posted")).toBe("LEDGER_JOURNAL_POSTED");
  });
  it("names are unique and map onto database enum values", () => {
    expect(new Set(EVENT_NAMES).size).toBe(EVENT_NAMES.length);
    for (const e of EVENTS) expect(e.name.replace(/\./g, "_").toUpperCase()).toMatch(/^[A-Z_]+$/);
    expect(EVENT_NAMES).toEqual(expect.arrayContaining(["transfer.completed", "ledger.journal.posted", "erp.sync_failed", "document.received", "kyb.approved"]));
  });
});

describe("connectors against local stubs", () => {
  let server: http.Server; let base = ""; const seen: { path: string; headers: http.IncomingHttpHeaders; body: any }[] = []; let mode = "ok";
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let b = ""; req.on("data", c => (b += c));
      req.on("end", () => {
        const send = (code: number, j: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
        let body: any = b; try { body = JSON.parse(b); } catch { body = Object.fromEntries(new URLSearchParams(b)); }
        seen.push({ path: req.url!, headers: req.headers, body });
        if (req.url!.includes("/token")) return body.grant_type === "refresh_token" && body.refresh_token === "bad" ? send(400, { error: "invalid_grant" }) : send(200, { access_token: "acc", refresh_token: "ref", expires_in: 3600 });
        if (mode === "401") return send(401, {});
        if (req.url!.includes("journalentry")) return send(200, { JournalEntry: { Id: "55" } });
        if (req.url!.includes("/organizations")) return send(200, { organizations: [{ organization_id: "ZO1" }] });
        if (req.url!.includes("/journals")) return send(201, { journal: { journal_id: "ZJ1" } });
        if (req.url!.includes("/connections")) return send(200, [{ tenantId: "XT1" }]);
        if (req.url!.includes("ManualJournals")) return send(200, { ManualJournals: [{ ManualJournalID: "XJ1" }] });
        send(404, {});
      });
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    Object.assign(process.env, { QUICKBOOKS_CLIENT_ID: "qid", QUICKBOOKS_CLIENT_SECRET: "qsec", QUICKBOOKS_TOKEN_URL: `${base}/token`, QUICKBOOKS_API_BASE: base, ZOHO_CLIENT_ID: "zid", ZOHO_CLIENT_SECRET: "zsec", ZOHO_ACCOUNTS_URL: base, ZOHO_API_BASE: base, XERO_CLIENT_ID: "xid", XERO_CLIENT_SECRET: "xsec", XERO_IDENTITY_URL: base, XERO_API_BASE: base });
  });
  afterAll(() => { server.close(); });
  const v = buildVoucher(T(), "RECEIPT");
  const ctx = (mapping: object = { bank: "B1", charges: "C1", party: "P1" }) => ({ tokens: { access: "tok" }, tenant: "TEN", mapping });

  it("QuickBooks: Basic-auth token exchange, realm from the callback, debit/credit lines with account refs, idempotent request id", async () => {
    const c = await quickbooks.connect("code", "https://app/cb", { realmId: "R1" });
    expect(c.tenant).toBe("R1"); expect(c.tokens.access).toBe("acc");
    const tokReq = seen.find(s => s.path === "/token")!;
    expect(tokReq.headers.authorization).toBe(`Basic ${Buffer.from("qid:qsec").toString("base64")}`);
    await expect(quickbooks.connect("code", "https://app/cb", {})).rejects.toThrow(/realmId/);
    const r = await quickbooks.push(ctx(), v);
    expect(r.externalId).toBe("55");
    const call = seen.filter(s => s.path.includes("/journalentry")).at(-1)!;
    expect(call.path).toContain("/v3/company/TEN/journalentry"); expect(call.path).toMatch(/requestid=[0-9a-f]{32}/);
    expect(call.body.TxnDate).toBe("2026-10-05"); expect(call.body.DocNumber).toBe("INV-1");
    const debits = call.body.Line.filter((l: any) => l.JournalEntryLineDetail.PostingType === "Debit").reduce((s: number, l: any) => s + l.Amount, 0);
    const credits = call.body.Line.filter((l: any) => l.JournalEntryLineDetail.PostingType === "Credit").reduce((s: number, l: any) => s + l.Amount, 0);
    expect(debits).toBeCloseTo(credits, 2);
    expect(call.body.Line.map((l: any) => l.JournalEntryLineDetail.AccountRef.value).sort()).toEqual(["B1", "C1", "P1"]);
    expect(call.headers.authorization).toBe("Bearer tok");
  });
  it("Zoho: organization lookup, Zoho-oauthtoken header, debit_or_credit lines", async () => {
    const c = await zoho.connect("code", "https://app/cb", {});
    expect(c.tenant).toBe("ZO1");
    const r = await zoho.push(ctx(), v);
    expect(r.externalId).toBe("ZJ1");
    const call = seen.filter(s => s.path.startsWith("/books/v3/journals")).at(-1)!;
    expect(call.path).toContain("organization_id=TEN"); expect(call.headers.authorization).toBe("Zoho-oauthtoken tok");
    expect(call.body.line_items.map((l: any) => l.debit_or_credit).sort()).toEqual(["credit", "debit", "debit"]);
    expect(call.body.journal_date).toBe("2026-10-05");
  });
  it("Xero: tenant from /connections, xero-tenant-id + Idempotency-Key, signed LineAmounts that sum to zero", async () => {
    const c = await xero.connect("code", "https://app/cb", {});
    expect(c.tenant).toBe("XT1");
    const r = await xero.push(ctx({ bank: "090", charges: "404", party: "800" }), v);
    expect(r.externalId).toBe("XJ1");
    const call = seen.filter(s => s.path.includes("ManualJournals")).at(-1)!;
    expect(call.headers["xero-tenant-id"]).toBe("TEN"); expect(String(call.headers["idempotency-key"])).toMatch(/^[0-9a-f]{40}$/);
    const lines = call.body.ManualJournals[0].JournalLines;
    expect(lines.reduce((s: number, l: any) => s + l.LineAmount, 0)).toBeCloseTo(0, 2);
    expect(lines.map((l: any) => l.AccountCode).sort()).toEqual(["090", "404", "800"]);
  });
  it("a rejected token raises ErpAuthError (the sync engine then refreshes); a dead refresh token asks to reconnect", async () => {
    mode = "401";
    await expect(quickbooks.push(ctx(), v)).rejects.toBeInstanceOf(ErpAuthError);
    mode = "ok";
    await expect(xero.refresh({ access: "x", refresh: "bad" })).rejects.toBeInstanceOf(ErpAuthError);
    expect((await zoho.refresh({ access: "x", refresh: "r1" })).access).toBe("acc");
  });
  it("auth URLs carry the state and the right scopes", () => {
    expect(quickbooks.authUrl("S1", "https://app/cb")).toMatch(/scope=com\.intuit\.quickbooks\.accounting.*state=S1|state=S1.*scope/);
    expect(xero.authUrl("S2", "https://app/cb")).toContain("offline_access");
    expect(zoho.authUrl("S3", "https://app/cb")).toContain("access_type=offline");
  });
});
