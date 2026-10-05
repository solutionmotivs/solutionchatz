import http from "node:http";
import { AddressInfo } from "node:net";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import {
  mask, validateAba, validateBankAccount, validateCin, validateEin, validateGstin, validateIban, validateIfsc, validateLei, validatePan,
} from "../lib/kyc/validators";
import { missingForSubmission, requirementsFor, uboThreshold } from "../lib/kyc/requirements";
import { approvalsNeeded, assessRisk, tierLimits } from "../lib/kyc/risk";
import { SandboxCoInProvider } from "../lib/kyc/providers/sandbox-co-in";
import { MockProvider } from "../lib/kyc/providers/mock";
import { sniffFile, safeFilename, setStoreForTests, saveEncrypted, loadDecrypted } from "../lib/storage";
import { evaluateTransfer, type GuardContext } from "../lib/guardrails";

describe("identifier validators", () => {
  it("PAN: format and holder type", () => {
    expect(validatePan("ABCPE1234F", "INDIVIDUAL")).toBeNull();
    expect(validatePan("ABCCE1234F", "INDIVIDUAL")).toMatch(/individual/);
    expect(validatePan("ABCCE1234F", "BUSINESS")).toBeNull();
    expect(validatePan("ABCPE1234F", "BUSINESS")).toMatch(/business/);
    expect(validatePan("abc", "BUSINESS")).toMatch(/PAN/);
  });
  it("GSTIN: checksum", () => {
    expect(validateGstin("24ABKCS2033B1ZV")).toBeNull(); // example from the provider's public docs
    expect(validateGstin("24ABKCS2033B1ZW")).toMatch(/check/);
    expect(validateGstin("123")).toMatch(/15/);
  });
  it("CIN, LLPIN, IFSC, EIN", () => {
    expect(validateCin("U74999MH2015PTC123456")).toBeNull();
    expect(validateCin("AAB-1234")).toBeNull();
    expect(validateCin("X123")).not.toBeNull();
    expect(validateIfsc("HDFC0001234")).toBeNull();
    expect(validateIfsc("HDFC1001234")).not.toBeNull();
    expect(validateEin("12-3456789")).toBeNull();
    expect(validateEin("1234")).not.toBeNull();
  });
  it("IBAN, ABA and LEI checksums", () => {
    expect(validateIban("GB82 WEST 1234 5698 7654 32")).toBeNull();
    expect(validateIban("DE89370400440532013000")).toBeNull();
    expect(validateIban("DE89370400440532013001")).not.toBeNull();
    expect(validateAba("021000021")).toBeNull();
    expect(validateAba("021000022")).not.toBeNull();
    expect(validateLei("5493001KJTIIGC8Y1R12")).toBeNull();
    expect(validateLei("5493001KJTIIGC8Y1R13")).not.toBeNull();
  });
  it("bank account formats by country", () => {
    expect(validateBankAccount("HDFC0001234|123456789012", "IN")).toBeNull();
    expect(validateBankAccount("HDFC0001234", "IN")).not.toBeNull();
    expect(validateBankAccount("021000021|123456789", "US")).toBeNull();
    expect(validateBankAccount("DE89370400440532013000", "DE")).toBeNull();
  });
  it("masking keeps only the last four", () => {
    expect(mask("ABCPE1234F")).toBe("******234F");
    expect(mask("1234")).toBe("****");
  });
});

describe("requirement matrix", () => {
  it("Indian goods exporter needs IEC, GSTIN and 10% beneficial owners", () => {
    const r = requirementsFor("KYB", "IN", ["EXPORT_GOODS"]);
    expect(r.items.filter(i => i.required).map(i => i.code)).toEqual(expect.arrayContaining(["PAN", "CIN", "GSTIN", "IEC", "BANK_ACCOUNT"]));
    expect(r.uboThresholdPct).toBe(10);
    expect(r.documents.find(d => d.type === "IEC_CERTIFICATE")?.required).toBe(true);
  });
  it("Indian services exporter does not need IEC", () => {
    const r = requirementsFor("KYB", "IN", ["EXPORT_SERVICES"]);
    expect(r.items.find(i => i.code === "IEC")?.required).toBe(false);
  });
  it("US business needs EIN and W-9; thresholds are 25% outside India", () => {
    const r = requirementsFor("KYB", "US", ["IMPORT_GOODS"]);
    expect(r.items.some(i => i.code === "EIN" && i.required)).toBe(true);
    expect(r.documents.some(d => d.type === "TAX_FORM_W9" && d.required)).toBe(true);
    expect(uboThreshold("US")).toBe(25);
  });
  it("Indian LRS sender needs PAN and proof of funds", () => {
    const r = requirementsFor("KYC", "IN", ["LRS_OUTWARD"]);
    expect(r.items.find(i => i.code === "PAN")?.required).toBe(true);
    expect(r.documents.some(d => d.type === "SOURCE_OF_FUNDS_PROOF" && d.required)).toBe(true);
  });
  it("lists what is missing and clears as things are added", () => {
    const r = requirementsFor("KYC", "IN", ["FAMILY_MAINTENANCE"]);
    const empty = missingForSubmission(r, { profile: {}, items: [], people: [], documents: [] });
    expect(empty.map(m => m.key)).toEqual(expect.arrayContaining(["occupation", "PAN", "BANK_ACCOUNT", "APPLICANT", "ID_PROOF", "ADDRESS_PROOF"]));
    const full = missingForSubmission(r, {
      profile: { occupation: "Engineer", address: "x", expected_monthly_usd: 500, source_of_funds: "SALARY" },
      items: [{ code: "PAN", status: "VERIFIED" }, { code: "BANK_ACCOUNT", status: "MANUAL" }],
      people: [{ role: "APPLICANT" }],
      documents: [{ type: "ID_PROOF", personId: "p1", status: "UPLOADED" }, { type: "ADDRESS_PROOF", status: "UPLOADED" }],
    });
    expect(full).toEqual([]);
  });
  it("a failed identifier or rejected document counts as missing; ownership over 100% is flagged", () => {
    const r = requirementsFor("KYC", "IN", ["FAMILY_MAINTENANCE"]);
    const m = missingForSubmission(r, {
      profile: { occupation: "x", address: "x", expected_monthly_usd: 1, source_of_funds: "SALARY" },
      items: [{ code: "PAN", status: "FAILED" }, { code: "BANK_ACCOUNT", status: "VERIFIED" }],
      people: [{ role: "APPLICANT" }],
      documents: [{ type: "ID_PROOF", personId: "p", status: "REJECTED" }, { type: "ADDRESS_PROOF", status: "ACCEPTED" }],
    });
    expect(m.map(x => x.key).sort()).toEqual(["ID_PROOF", "PAN"]);
    const kyb = requirementsFor("KYB", "US", ["IMPORT_GOODS"]);
    const over = missingForSubmission(kyb, { profile: {}, items: [], people: [{ role: "UBO", ownershipPct: 70 }, { role: "UBO", ownershipPct: 50 }], documents: [] });
    expect(over.some(x => /more than 100/.test(x.label))).toBe(true);
  });
});

describe("risk scoring", () => {
  const base = { kind: "KYB" as const, country: "IN", purposes: ["EXPORT_SERVICES"], industry: "Software", expectedMonthlyUsd: 20_000, incorporationDate: "2018-01-01", screening: "CLEAR" as const, items: [{ status: "VERIFIED" }], people: [{ role: "UBO", isPep: false, ownershipPct: 100, nationality: "IN" }] };
  it("a plain domestic software exporter is low risk (SDD)", () => {
    const r = assessRisk(base, new Date("2026-10-01"));
    expect(r.tier).toBe("SDD");
    expect(r.blocked).toBe(false);
  });
  it("PEP or high-risk industry forces EDD", () => {
    expect(assessRisk({ ...base, people: [{ role: "UBO", isPep: true, ownershipPct: 100 }] }).tier).toBe("EDD");
    expect(assessRisk({ ...base, industry: "Crypto exchange" }).tier).toBe("EDD");
  });
  it("prohibited jurisdiction or sanctions match blocks onboarding", () => {
    expect(assessRisk({ ...base, people: [{ role: "UBO", isPep: false, ownershipPct: 100, nationality: "IR" }] }).blocked).toBe(true);
    expect(assessRisk({ ...base, screening: "BLOCK" }).blocked).toBe(true);
    expect(assessRisk({ ...base, screening: "REVIEW" }).tier).toBe("EDD");
  });
  it("volume and incomplete ownership raise the tier to CDD", () => {
    const r = assessRisk({ ...base, expectedMonthlyUsd: 300_000, people: [{ role: "UBO", isPep: false, ownershipPct: 40 }] });
    expect(r.tier).toBe("CDD");
  });
  it("limits grow with tier; EDD needs two approvers", () => {
    expect(tierLimits("KYB", "CDD").perTxnUsd).toBeGreaterThan(tierLimits("KYB", "SDD").perTxnUsd);
    expect(tierLimits("KYC", null).monthlyUsd).toBe(0);
    expect(approvalsNeeded("EDD")).toBe(2);
    expect(approvalsNeeded("CDD")).toBe(1);
  });
});

describe("tier limits in guardrails", () => {
  const ctx = (over: Partial<GuardContext> = {}): GuardContext => ({
    kind: "BUSINESS", originCountry: "US", destCountry: "DE", amountUsd: 5_000, fundingMethod: "FIAT_LOCAL", usesStablecoin: false, token: null,
    payoutAssetIsFiat: true, invoiceId: "inv", sender: { verified: true, entityType: "BUSINESS", country: "US", limits: { perTxnUsd: 10_000, dailyUsd: 15_000, monthlyUsd: 50_000 } },
    recipient: { verified: true, entityType: "BUSINESS", country: "DE" }, indiaAuths: [], history: { recipientTransfersThisCalendarYear: 0, senderUsdThisFinancialYear: 0, senderUsdLast24h: 0, senderUsdLast30d: 0 }, ...over,
  });
  it("allows within limits", () => expect(evaluateTransfer(ctx()).allowed).toBe(true));
  it("refuses above the per-transfer limit", () => expect(evaluateTransfer(ctx({ amountUsd: 12_000 })).violations.map(v => v.code)).toContain("TIER_TXN_LIMIT"));
  it("refuses when the daily total would be exceeded", () =>
    expect(evaluateTransfer(ctx({ history: { recipientTransfersThisCalendarYear: 0, senderUsdThisFinancialYear: 0, senderUsdLast24h: 12_000, senderUsdLast30d: 12_000 } })).violations.map(v => v.code)).toContain("TIER_DAILY_LIMIT"));
  it("refuses when the 30-day total would be exceeded", () =>
    expect(evaluateTransfer(ctx({ history: { recipientTransfersThisCalendarYear: 0, senderUsdThisFinancialYear: 0, senderUsdLast24h: 0, senderUsdLast30d: 48_000 } })).violations.map(v => v.code)).toContain("TIER_MONTHLY_LIMIT"));
});

describe("mock provider", () => {
  const p = new MockProvider();
  it("is deterministic", async () => {
    expect((await p.verify({ code: "PAN", value: "ABCPE1234F", country: "IN", holder: "INDIVIDUAL" })).status).toBe("VERIFIED");
    expect((await p.verify({ code: "PAN", value: "ZZZPZ1234Z", country: "IN", holder: "INDIVIDUAL" })).status).toBe("FAILED");
    expect((await p.verify({ code: "BANK_ACCOUNT", value: "HDFC0001234|123450000", country: "IN", holder: "BUSINESS" })).status).toBe("FAILED");
  });
});

describe("Sandbox.co.in adapter (contract test against a local stub)", () => {
  let server: http.Server; let base = "";
  const seen: { path: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
  let authCalls = 0;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = ""; req.on("data", c => (body += c));
      req.on("end", () => {
        seen.push({ path: req.url!, headers: req.headers, body });
        const send = (code: number, json: unknown) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(json)); };
        if (req.url === "/authenticate") { authCalls++; return req.headers["x-api-secret"] === "sec" ? send(200, { code: 200, data: { access_token: "jwt-token" } }) : send(401, { message: "bad" }); }
        if (req.headers.authorization !== "jwt-token") return send(401, { message: "unauthorised" });
        if (req.url === "/kyc/pan/verify") {
          const b = JSON.parse(body);
          return send(200, { code: 200, transaction_id: "tx-pan", data: { pan: b.pan, category: "individual", status: "valid", name_as_per_pan_match: b.name_as_per_pan === "Asha Rao", date_of_birth_match: true } });
        }
        if (req.url === "/gst/compliance/public/gstin/verify") {
          const b = JSON.parse(body);
          return send(200, { code: 200, transaction_id: "tx-gst", data: { data: { legalName: "ACME PRIVATE LIMITED", validGstin: b.gstin !== "24ABKCS2033B1ZX", status: b.gstin === "24ABKCS2033B1ZY" ? "Cancelled" : "Active", pan: "ABKCS2033B", stateName: "Gujarat" } } });
        }
        if (req.url!.startsWith("/bank/HDFC0001234/accounts/")) return req.url!.includes("/999/") ? send(500, { message: "upstream" }) : req.url!.includes("/404/") ? send(400, { message: "invalid account" }) : send(200, { code: 200, transaction_id: "tx-bank", data: { account_exists: true, name_at_bank: "ASHA RAO" } });
        send(404, { message: "nope" });
      });
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server.close(); });

  const mk = () => new SandboxCoInProvider({ baseUrl: base, apiKey: "key", apiSecret: "sec" });
  it("authenticates once, sends the token without Bearer, and matches name + DOB for PAN", async () => {
    const p = mk();
    const ok = await p.verify({ code: "PAN", value: "ABCPE1234F", country: "IN", holder: "INDIVIDUAL", name: "Asha Rao", dateOfBirth: "01/02/1990" });
    expect(ok.status).toBe("VERIFIED");
    const bad = await p.verify({ code: "PAN", value: "ABCPE1234F", country: "IN", holder: "INDIVIDUAL", name: "Someone Else", dateOfBirth: "01/02/1990" });
    expect(bad.status).toBe("FAILED");
    expect(authCalls).toBe(1);
    const call = seen.find(s => s.path === "/kyc/pan/verify")!;
    expect(call.headers.authorization).toBe("jwt-token");
    expect(call.headers["x-api-key"]).toBe("key");
    expect(JSON.parse(call.body)).toMatchObject({ consent: "Y", "@entity": "in.co.sandbox.kyc.pan_verification.request" });
  });
  it("GSTIN: active verifies, cancelled/invalid fail", async () => {
    const p = mk();
    expect((await p.verify({ code: "GSTIN", value: "24ABKCS2033B1ZV", country: "IN", holder: "BUSINESS" })).status).toBe("VERIFIED");
    expect((await p.verify({ code: "GSTIN", value: "24ABKCS2033B1ZY", country: "IN", holder: "BUSINESS" })).status).toBe("FAILED");
    expect((await p.verify({ code: "GSTIN", value: "24ABKCS2033B1ZX", country: "IN", holder: "BUSINESS" })).status).toBe("FAILED");
  });
  it("bank: 200 verifies, 4xx fails, 5xx falls back to manual (UNAVAILABLE)", async () => {
    const p = mk();
    expect((await p.verify({ code: "BANK_ACCOUNT", value: "HDFC0001234|123456", country: "IN", holder: "BUSINESS" })).status).toBe("VERIFIED");
    expect((await p.verify({ code: "BANK_ACCOUNT", value: "HDFC0001234|404", country: "IN", holder: "BUSINESS" })).status).toBe("FAILED");
    expect((await p.verify({ code: "BANK_ACCOUNT", value: "HDFC0001234|999", country: "IN", holder: "BUSINESS" })).status).toBe("UNAVAILABLE");
  });
  it("wrong credentials or an unreachable provider never produce a false VERIFIED", async () => {
    const wrong = new SandboxCoInProvider({ baseUrl: base, apiKey: "key", apiSecret: "wrong" });
    expect((await wrong.verify({ code: "GSTIN", value: "24ABKCS2033B1ZV", country: "IN", holder: "BUSINESS" })).status).toBe("UNAVAILABLE");
    const down = new SandboxCoInProvider({ baseUrl: "http://127.0.0.1:1", apiKey: "k", apiSecret: "s", timeoutMs: 500 });
    expect((await down.verify({ code: "GSTIN", value: "24ABKCS2033B1ZV", country: "IN", holder: "BUSINESS" })).status).toBe("UNAVAILABLE");
  });
  it("PAN without name/date is not guessed", async () => {
    expect((await mk().verify({ code: "PAN", value: "ABCPE1234F", country: "IN", holder: "INDIVIDUAL" })).status).toBe("UNAVAILABLE");
  });
});

describe("document storage", () => {
  it("decides type from content, not from the filename", () => {
    expect(sniffFile(Buffer.from("%PDF-1.7\n..."))?.mime).toBe("application/pdf");
    expect(sniffFile(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime).toBe("image/png");
    expect(sniffFile(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe("image/jpeg");
    expect(sniffFile(Buffer.from("<script>alert(1)</script>"))).toBeNull();
    expect(sniffFile(Buffer.from("MZ\x90\x00"))).toBeNull();
  });
  it("sanitises filenames", () => {
    expect(safeFilename("../../etc/passwd.exe", "pdf")).toBe("passwd.pdf");
    expect(safeFilename("my résumé<>.png", "png")).toBe("my r_sum___.png");
  });
  it("stores only ciphertext and returns the original bytes", async () => {
    const mem = new Map<string, Buffer>();
    setStoreForTests({ put: async (k, d) => { mem.set(k, d); }, get: async k => mem.get(k)!, delete: async k => { mem.delete(k); } });
    const plain = Buffer.from("%PDF-1.4 secret passport scan");
    const { key, sha256 } = await saveEncrypted(plain, "kyc/o1/c1");
    expect(mem.get(key)!.includes(Buffer.from("secret passport"))).toBe(false);
    expect((await loadDecrypted(key)).equals(plain)).toBe(true);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
    setStoreForTests(undefined);
  });
});

describe("S3-compatible store (against a local stub)", () => {
  it("puts, gets and deletes objects through the S3 client", async () => {
    const objects = new Map<string, Buffer>();
    const srv = http.createServer((req, res) => {
      const chunks: Buffer[] = []; req.on("data", c => chunks.push(c));
      req.on("end", () => {
        const key = req.url!.split("?")[0];
        if (req.method === "PUT") { objects.set(key, Buffer.concat(chunks)); res.writeHead(200, { ETag: '"x"' }); return res.end(); }
        if (req.method === "GET") { const o = objects.get(key); if (!o) { res.writeHead(404); return res.end(); } res.writeHead(200, { "content-length": o.length }); return res.end(o); }
        if (req.method === "DELETE") { objects.delete(key); res.writeHead(204); return res.end(); }
        res.writeHead(405); res.end();
      });
    });
    await new Promise<void>(r => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as AddressInfo).port;
    const env = { ...process.env };
    Object.assign(process.env, { S3_BUCKET: "kyc", S3_ENDPOINT: `http://127.0.0.1:${port}`, S3_FORCE_PATH_STYLE: "true", S3_ACCESS_KEY_ID: "ak", S3_SECRET_ACCESS_KEY: "sk", S3_REGION: "us-east-1" });
    setStoreForTests(undefined);
    const { getStore } = await import("../lib/storage");
    const plain = Buffer.from("%PDF-1.4 bank statement");
    const { key } = await saveEncrypted(plain, "kyc/o/c");
    expect(objects.size).toBe(1);
    expect([...objects.values()][0].includes(Buffer.from("bank statement"))).toBe(false);
    expect((await loadDecrypted(key)).equals(plain)).toBe(true);
    await getStore().delete(key);
    expect(objects.size).toBe(0);
    setStoreForTests(undefined);
    for (const k of ["S3_BUCKET", "S3_ENDPOINT", "S3_FORCE_PATH_STYLE", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_REGION"]) { if (env[k] === undefined) delete process.env[k]; }
    srv.close();
  });
});
