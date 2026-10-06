import http from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApisetuClient, DEFAULT_PATHS } from "../lib/kyc/providers/apisetu/client";
import { ApisetuServices, MockApisetu } from "../lib/kyc/providers/apisetu/services";

describe("API Setu services (contract test against a local stub)", () => {
  let server: http.Server; let base = ""; const seen: { url: string; headers: http.IncomingHttpHeaders; body: any }[] = []; let flaky = 0;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let b = ""; req.on("data", c => (b += c));
      req.on("end", () => {
        const body = b ? JSON.parse(b) : {}; seen.push({ url: req.url!, headers: req.headers, body });
        const send = (c: number, j: unknown) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
        if (req.headers["x-apisetu-apikey"] !== "key" || req.headers["x-apisetu-clientid"] !== "cid") return send(401, { message: "bad credentials" });
        if (req.url === DEFAULT_PATHS.ckycSearch) return body.id_number === "ZZZ" ? send(200, { found: false }) : send(200, { referenceId: "ref-1", ckycNumberMasked: "XXXXXXXX4321" });
        if (req.url === DEFAULT_PATHS.ckycDownload) return body.otp === "123456" ? send(200, { data: { fullName: "ASHA RAO", dob: "1980-05-05", ckycNumber: "50012345678901", gender: "F" } }) : send(400, { message: "Invalid OTP" });
        if (req.url === DEFAULT_PATHS.amlPep) { if (flaky++ < 1) return send(503, {}); return body.name.includes("MINISTER") ? send(200, { matches: [{ name: "A MINISTER", category: "PEP", list: "IN_PEP", score: 0.98 }, { name: "A MINISTER", category: "ADVERSE_MEDIA" }] }) : send(200, { matches: [] }); }
        if (req.url === DEFAULT_PATHS.ocr) return send(200, { data: { name: "ASHA RAO", dob: "05/05/1980", idNumber: "ABCPE1234F", documentType: "PAN" } });
        if (req.url === DEFAULT_PATHS.ocrQuality) return send(200, { qualityScore: body.mime_type === "image/png" ? 0.2 : 0.9, issues: body.mime_type === "image/png" ? ["image is blurry"] : [] });
        send(404, {});
      });
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server.close(); });
  const svc = () => new ApisetuServices(new ApisetuClient({ baseUrl: base, clientId: "cid", apiKey: "key", paths: DEFAULT_PATHS }));

  it("CKYC: search sends the OTP step, download needs the right OTP and masks the CKYC number", async () => {
    const s = svc();
    expect(await s.ckycSearch({ idType: "PAN", idNumber: "ABCPE1234F" })).toMatchObject({ status: "OTP_SENT", referenceId: "ref-1" });
    expect((await s.ckycSearch({ idType: "PAN", idNumber: "ZZZ" })).status).toBe("NOT_FOUND");
    const ok = await s.ckycDownload({ referenceId: "ref-1", otp: "123456" });
    expect(ok).toMatchObject({ status: "VERIFIED", name: "ASHA RAO", dob: "1980-05-05" });
    expect(ok.ckycMasked).toMatch(/\*+8901$/); expect(JSON.stringify(ok)).not.toContain("50012345678901");
    expect((await s.ckycDownload({ referenceId: "ref-1", otp: "000000" })).status).toBe("FAILED");
  });
  it("sends the API Setu client id and key headers", () => {
    expect(seen.every(x => x.headers["x-apisetu-clientid"] === "cid" && x.headers["x-apisetu-apikey"] === "key")).toBe(true);
  });
  it("AML/PEP: retries a 503, flags PEP and adverse media, clear otherwise", async () => {
    const s = svc();
    const hit = await s.amlPep({ name: "A MINISTER", kind: "INDIVIDUAL" });
    expect(hit).toMatchObject({ status: "REVIEW", pep: true, adverseMedia: true, sanctioned: false });
    expect(await s.amlPep({ name: "Ordinary Person", kind: "INDIVIDUAL" })).toMatchObject({ status: "CLEAR", pep: false });
  });
  it("OCR: reads fields (ID number masked) and gates on quality", async () => {
    const s = svc();
    const good = await s.ocr({ docType: "PAN_CARD", data: Buffer.from("x"), mime: "application/pdf" });
    expect(good).toMatchObject({ status: "OK", fields: { name: "ASHA RAO", dob: "05/05/1980" } });
    expect(good.fields.idNumberMasked).toMatch(/\*+234F$/); expect(JSON.stringify(good)).not.toContain("ABCPE1234F");
    expect((await s.ocr({ docType: "PAN_CARD", data: Buffer.from("x"), mime: "image/png" })).status).toBe("POOR_QUALITY");
  });
  it("wrong credentials or a dead provider never throw: they report UNAVAILABLE so the case goes to manual review", async () => {
    const bad = new ApisetuServices(new ApisetuClient({ baseUrl: base, clientId: "cid", apiKey: "nope", paths: DEFAULT_PATHS }));
    expect((await bad.ckycSearch({ idType: "PAN", idNumber: "ABCPE1234F" })).status).toBe("UNAVAILABLE");
    expect((await bad.amlPep({ name: "x", kind: "INDIVIDUAL" })).status).toBe("UNAVAILABLE");
    expect((await bad.ocr({ docType: "ID_PROOF", data: Buffer.from("x"), mime: "image/png" })).status).toBe("UNAVAILABLE");
    const dead = new ApisetuServices(new ApisetuClient({ baseUrl: "http://127.0.0.1:1", clientId: "c", apiKey: "k", paths: DEFAULT_PATHS, timeoutMs: 500 }));
    expect((await dead.ckycDownload({ referenceId: "r", otp: "1" })).status).toBe("UNAVAILABLE");
  });
});

describe("mock provider used in development", () => {
  it("is deterministic: PEP by name, OCR fields and blur from text in the file", async () => {
    const m = new MockApisetu();
    expect((await m.amlPep({ name: "Rahul PEP Kumar" })).pep).toBe(true);
    expect((await m.amlPep({ name: "Rahul Kumar" })).pep).toBe(false);
    const r = await m.ocr({ data: Buffer.from("%PDF NAME:ASHA RAO;DOB:1980-05-05;ID:ABCPE1234F") });
    expect(r.fields).toMatchObject({ name: "ASHA RAO", dob: "1980-05-05" });
    expect((await m.ocr({ data: Buffer.from("%PDF NAME:X;BLUR:1") })).status).toBe("POOR_QUALITY");
    expect((await m.ckycDownload({ referenceId: "r", otp: "123456" })).status).toBe("VERIFIED");
  });
});
