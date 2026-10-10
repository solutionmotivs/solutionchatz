import http from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requirementsFor } from "../lib/kyc/requirements";
import { validateAbn, validateAcn, validateBankAccount, validateEuVat, validateMyBrn, validateNepalPan, validateSaCr, validateSaVat, validateUaeTrn, validateUkVat, euVatNumber } from "../lib/kyc/validators";
import { AbnLookupAdapter, CompaniesHouseAdapter, GleifAdapter, ViesAdapter } from "../lib/kyc/registries/adapters";
import { lookupRegistry, nameMatchScore, setRegistryAdaptersForTests } from "../lib/kyc/registries";
import { registryToCheck } from "../lib/kyc/service";
import { registryInfo } from "../lib/kyc/countries";

describe("country identifier validators", () => {
  it("ABN / ACN checksums", () => {
    expect(validateAbn("51 824 753 556")).toBeNull();
    expect(validateAbn("51 824 753 557")).toMatch(/check digits/);
    expect(validateAbn("123")).toMatch(/11 digits/);
    expect(validateAcn("004 085 616")).toBeNull();
    expect(validateAcn("004 085 617")).toMatch(/check digit/);
  });
  it("EU VAT formats by country, with or without prefix; Greece uses EL", () => {
    expect(validateEuVat("DE")("DE123456789")).toBeNull();
    expect(validateEuVat("DE")("123456789")).toBeNull();
    expect(validateEuVat("DE")("DE12345")).toMatch(/VAT number/);
    expect(validateEuVat("NL")("NL123456789B01")).toBeNull();
    expect(validateEuVat("GR")("EL123456789")).toBeNull();
    expect(validateEuVat("FR")("FR40303265045")).toBeNull();
    expect(validateEuVat("US")("123")).toMatch(/not issued/);
    expect(euVatNumber("GR", "el 123.456.789")).toBe("123456789");
  });
  it("Gulf, Malaysia, Nepal, UK", () => {
    expect(validateUaeTrn("100123456789003")).toBeNull(); expect(validateUaeTrn("1001")).toMatch(/15 digits/);
    expect(validateSaCr("1010123456")).toBeNull(); expect(validateSaCr("9010123456")).toMatch(/10 digits/);
    expect(validateSaVat("300123456789003")).toBeNull(); expect(validateSaVat("200123456789003")).toMatch(/starting and ending with 3/);
    expect(validateMyBrn("201901234567")).toBeNull(); expect(validateMyBrn("123456-X")).toBeNull(); expect(validateMyBrn("abc")).toMatch(/SSM/);
    expect(validateNepalPan("123456789")).toBeNull(); expect(validateNepalPan("12345")).toMatch(/9 digits/);
    expect(validateUkVat("GB123456789")).toBeNull(); expect(validateUkVat("12")).toMatch(/9 digits/);
  });
  it("bank account formats: AU BSB, BIC for non-IBAN countries, IBAN where used", () => {
    expect(validateBankAccount("062000|12345678", "AU")).toBeNull();
    expect(validateBankAccount("06200|1", "AU")).toMatch(/BSB/);
    expect(validateBankAccount("MBBEMYKL|514012345678", "MY")).toBeNull();
    expect(validateBankAccount("NABILNPK|0012345678901", "NP")).toBeNull();
    expect(validateBankAccount("hello", "MY")).toMatch(/BIC/);
    expect(validateBankAccount("AE070331234567890123456", "AE")).toBeNull();
    expect(validateBankAccount("AE070331234567890123457", "AE")).toMatch(/check digits/);
  });
});

describe("country packs", () => {
  const codes = (c: string, kind: "KYB" | "KYC" = "KYB", p: string[] = ["EXPORT_SERVICES"]) => requirementsFor(kind, c, p);
  it("every requested market has its own registry identifier", () => {
    expect(codes("AU").items.find(i => i.code === "ABN")).toMatchObject({ required: true, registry: "ABN" });
    expect(codes("GB").items.find(i => i.code === "REG_NO")).toMatchObject({ required: true, registry: "REG_NO" });
    expect(codes("DE").items.find(i => i.code === "VAT_ID")).toMatchObject({ registry: "VAT_ID", autoVerifiable: true });
    expect(codes("AE").items.find(i => i.code === "TRADE_LICENCE")?.required).toBe(true);
    expect(codes("SA").items.find(i => i.code === "CR_NO")?.required).toBe(true);
    expect(codes("MY").items.find(i => i.code === "REG_NO")?.required).toBe(true);
    expect(codes("NP").items.find(i => i.code === "TAX_ID")?.required).toBe(true);
    expect(codes("IN", "KYB", ["EXPORT_GOODS"]).items.find(i => i.code === "GSTIN")).toMatchObject({ registry: "GSTIN", required: true });
  });
  it("EU VAT ID becomes mandatory for goods trade; entity types are localised", () => {
    expect(codes("FR").items.find(i => i.code === "VAT_ID")?.required).toBe(false);
    expect(codes("FR", "KYB", ["IMPORT_GOODS"]).items.find(i => i.code === "VAT_ID")?.required).toBe(true);
    expect(codes("AE").profile.find(f => f.key === "business_type")?.options).toContain("Free-zone company (FZE / FZ-LLC / FZCO)");
    expect(codes("MY").profile.find(f => f.key === "business_type")?.options).toContain("Private limited (Sdn Bhd)");
  });
  it("documents and notes reflect local law; individuals upload documents, not ID numbers", () => {
    expect(codes("SA").documents.some(d => d.type === "ADDRESS_PROOF" && /National Address/.test(d.label))).toBe(true);
    expect(codes("NP").notes.join(" ")).toMatch(/Nepal Rastra Bank/);
    const ind = requirementsFor("KYC", "AE", ["FAMILY_MAINTENANCE"]);
    expect(ind.notes.join(" ")).toMatch(/Emirates ID/);
    expect(ind.items.some(i => /ID/.test(i.code) && i.code !== "TAX_ID")).toBe(false);
    expect(requirementsFor("KYC", "MY", ["FAMILY_MAINTENANCE"]).items.find(i => i.code === "BANK_ACCOUNT")?.label).toMatch(/BIC/);
  });
  it("unknown countries still get a usable generic pack; registry info is exposed", () => {
    const r = codes("BR");
    expect(r.items.map(i => i.code)).toEqual(expect.arrayContaining(["REG_NO", "BANK_ACCOUNT"]));
    expect(registryInfo("DE")?.url).toMatch(/e-justice/); expect(registryInfo("AU")?.mode).toBe("KEYED"); expect(registryInfo("BR")).toBeNull();
  });
});

describe("official registry adapters (stub servers)", () => {
  let server: http.Server; let base = ""; const hits: string[] = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      hits.push(req.url!);
      const send = (c: number, j: unknown, raw?: string) => { res.writeHead(c, { "content-type": "application/json" }); res.end(raw ?? JSON.stringify(j)); };
      const u = req.url!;
      if (u.startsWith("/vies/ms/DE/vat/123456789")) return send(200, { isValid: true, userError: "VALID", name: "ACME GMBH", address: "HAUPTSTR 1\n10115 BERLIN", requestIdentifier: "ABC" });
      if (u.startsWith("/vies/ms/DE/vat/000000000")) return send(200, { isValid: false, userError: "INVALID", name: "---", address: "---" });
      if (u.startsWith("/vies/ms/DE/vat/999999999")) return send(200, { isValid: false, userError: "MS_MAX_CONCURRENT_REQ", name: "---", address: "---" });
      if (u.startsWith("/vies/ms/EL/vat/")) return send(200, { isValid: true, userError: "VALID", name: "HELLAS SA", address: "ATHENS" });
      if (u === "/gleif/lei-records/HWUPKR0MPOU8FGXBT394") return send(200, { data: { attributes: { lei: "HWUPKR0MPOU8FGXBT394", entity: { legalName: { name: "Apple Inc." }, status: "ACTIVE", legalAddress: { addressLines: ["1 Infinite Loop"], city: "Cupertino", country: "US" }, jurisdiction: "US-CA" }, registration: { status: "LAPSED" } } } });
      if (u.startsWith("/gleif/lei-records/")) return send(404, {});
      if (u === "/ch/company/01234567") return req.headers.authorization === "Basic " + Buffer.from("k:").toString("base64") ? send(200, { company_name: "ACME LTD", company_status: "active", type: "ltd", registered_office_address: { address_line_1: "1 High St", locality: "London", postal_code: "N1 1AA" } }) : send(401, {});
      if (u === "/ch/company/00000000") return send(404, {});
      if (u.startsWith("/abn/AbnDetails.aspx?abn=51824753556")) return send(200, null, `cb(${JSON.stringify({ Abn: "51824753556", AbnStatus: "Active", EntityName: "ACME PTY LTD", AddressState: "NSW", AddressPostcode: "2000", EntityTypeName: "Australian Private Company", Gst: "2000-07-01" })})`);
      if (u.startsWith("/abn/AbnDetails.aspx?abn=11111111111")) return send(200, null, `cb(${JSON.stringify({ Message: "Search text is not a valid ABN or ACN" })})`);
      send(500, {});
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server.close(); });

  it("VIES: valid → FOUND with cleaned name/address; INVALID → NOT_FOUND; member-state busy → UNAVAILABLE (never a rejection)", async () => {
    const v = new ViesAdapter(`${base}/vies`);
    expect(await v.lookup("VAT_ID", "DE123456789", "DE")).toMatchObject({ status: "FOUND", legalName: "ACME GMBH", address: "HAUPTSTR 1, 10115 BERLIN", active: true });
    expect((await v.lookup("VAT_ID", "DE000000000", "DE")).status).toBe("NOT_FOUND");
    expect(await v.lookup("VAT_ID", "DE999999999", "DE")).toMatchObject({ status: "UNAVAILABLE", reason: "VIES: MS_MAX_CONCURRENT_REQ" });
    expect((await v.lookup("VAT_ID", "EL123456789", "GR")).legalName).toBe("HELLAS SA");
    expect(v.supports("VAT_ID", "GR")).toBe(true); expect(v.supports("VAT_ID", "US")).toBe(false);
  });
  it("GLEIF: found (lapsed flagged inactive), not found, source down", async () => {
    const g = new GleifAdapter(`${base}/gleif`);
    expect(await g.lookup("LEI", "HWUPKR0MPOU8FGXBT394", "US")).toMatchObject({ status: "FOUND", legalName: "Apple Inc.", active: false });
    expect((await g.lookup("LEI", "00000000000000000000", "US")).status).toBe("NOT_FOUND");
    expect((await new GleifAdapter("http://127.0.0.1:1").lookup("LEI", "X", "US")).status).toBe("UNAVAILABLE");
  });
  it("Companies House: keyed basic auth; unconfigured → UNAVAILABLE", async () => {
    expect(await new CompaniesHouseAdapter("k", `${base}/ch`).lookup("REG_NO", "01234567", "GB")).toMatchObject({ status: "FOUND", legalName: "ACME LTD", active: true, address: "1 High St, London, N1 1AA" });
    expect((await new CompaniesHouseAdapter("k", `${base}/ch`).lookup("REG_NO", "00000000", "GB")).status).toBe("NOT_FOUND");
    expect((await new CompaniesHouseAdapter("wrong", `${base}/ch`).lookup("REG_NO", "01234567", "GB")).status).toBe("UNAVAILABLE");
    const none = new CompaniesHouseAdapter(undefined, `${base}/ch`);
    expect(none.configured()).toBe(false); expect((await none.lookup("REG_NO", "01234567", "GB")).status).toBe("UNAVAILABLE");
  });
  it("ABN Lookup: parses the JSONP wrapper", async () => {
    const a = new AbnLookupAdapter("guid", `${base}/abn`);
    expect(await a.lookup("ABN", "51 824 753 556", "AU")).toMatchObject({ status: "FOUND", legalName: "ACME PTY LTD", active: true });
    expect((await a.lookup("ABN", "11111111111", "AU")).status).toBe("NOT_FOUND");
  });
  it("front door caches positive answers (no repeat calls) and does not cache 'unavailable'", async () => {
    setRegistryAdaptersForTests([new ViesAdapter(`${base}/vies`)]);
    hits.length = 0;
    await lookupRegistry("VAT_ID", "DE123456789", "DE"); await lookupRegistry("VAT_ID", "de 123456789", "DE");
    expect(hits.length).toBe(1);
    await lookupRegistry("VAT_ID", "DE999999999", "DE"); await lookupRegistry("VAT_ID", "DE999999999", "DE");
    expect(hits.length).toBe(3);
    expect((await lookupRegistry("ABN", "51824753556", "AU")).status).toBe("UNAVAILABLE");
    setRegistryAdaptersForTests(null);
  });
});

describe("registry answer → verification outcome", () => {
  const rec = (o: object) => ({ status: "FOUND" as const, source: "x", sourceUrl: "u", details: {}, checkedAt: "", ...o });
  it("maps statuses and never auto-rejects on a down source or a name difference", () => {
    expect(registryToCheck("VAT_ID", rec({ status: "UNAVAILABLE" }))).toBeNull();
    expect(registryToCheck("VAT_ID", rec({ status: "NOT_FOUND" }))?.status).toBe("FAILED");
    expect(registryToCheck("REG_NO", rec({ legalName: "ACME LTD", active: false }))?.status).toBe("FAILED");
    expect(registryToCheck("LEI", rec({ legalName: "ACME LTD", active: false }))?.status).toBe("VERIFIED");
    expect(registryToCheck("ABN", rec({ legalName: "ACME PTY LTD", active: true }), "Acme Pty Limited")?.status).toBe("VERIFIED");
    const diff = registryToCheck("ABN", rec({ legalName: "ACME PTY LTD", active: true }), "Totally Different Trading");
    expect(diff?.status).toBe("UNAVAILABLE"); expect(diff?.reason).toMatch(/staff will review/);
  });
  it("name matching ignores legal-form words, case and accents", () => {
    expect(nameMatchScore("Müller Handels GmbH", "MULLER HANDELS")).toBe(1);
    expect(nameMatchScore("Alpha Exports Pvt Ltd", "ALPHA EXPORTS PRIVATE LIMITED")).toBe(1);
    expect(nameMatchScore("Alpha Exports", "Beta Imports")).toBe(0);
    expect(nameMatchScore("", "X")).toBe(0);
  });
});
