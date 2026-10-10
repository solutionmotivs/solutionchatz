import http from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NATIONAL_REGISTRIES, NationalRegistryAdapter } from "../lib/kyc/registries/adapters";

describe("national open registers (contract tests against a local stub with the real response shapes)", () => {
  let server: http.Server; let base = "";
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const send = (c: number, j: unknown) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
      const u = req.url ?? "";
      if (u.startsWith("/fr/search") && u.includes("999999999")) return send(200, { results: [{ siren: "999999999", nom_complet: null, nom_raison_sociale: null, siege: {} }] });
      if (u.startsWith("/fr/search")) return send(200, { results: u.includes("552032534") ? [{ siren: "552032534", nom_raison_sociale: "DANONE", etat_administratif: "A", nature_juridique: "5599", date_creation: "1955-01-01", siege: { adresse: "59-61 RUE LA FAYETTE 75009 PARIS" } }] : [] });
      if (u.startsWith("/no/enheter/923609016")) return send(200, { navn: "EQUINOR ASA", konkurs: false, underAvvikling: false, organisasjonsform: { kode: "ASA" }, forretningsadresse: { adresse: ["Forusbeen 50"], postnummer: "4035", poststed: "STAVANGER", land: "Norge" } });
      if (u.startsWith("/no/enheter/")) return send(404, {});
      if (u.startsWith("/cz/ekonomicke-subjekty/00006947")) return send(200, { ico: "00006947", obchodniJmeno: "Ministerstvo financí", pravniForma: "325", sidlo: { textovaAdresa: "Letenská 525/15, Praha 1" } });
      if (u.startsWith("/cz/ekonomicke-subjekty/00000001")) return send(200, { ico: "00000001", obchodniJmeno: "Old Co", datumZaniku: "2010-01-01", sidlo: {} });
      if (u.startsWith("/cz/")) return send(404, {});
      if (u.startsWith("/sg/datastore_search")) return send(200, { success: true, result: { records: decodeURIComponent(u).includes("198600294G") ? [{ uen: "198600294G", entity_name: "DBS VICKERS SECURITIES (SINGAPORE) PTE LTD", uen_status_desc: "Registered", reg_street_name: "MARINA BOULEVARD", reg_postal_code: "018982" }] : [] } });
      if (u.startsWith("/ee/autocomplete")) return send(200, { status: "OK", data: u.includes("11120894") ? [{ reg_code: 11120894, name: "Skype Invest OÜ", status: "R", legal_address: "Tallinn", zip_code: "10134" }] : [] });
      if (u.startsWith("/down/")) return send(503, {});
      send(404, {});
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server.close(); });
  const spec = (c: string, root: string) => { const s = NATIONAL_REGISTRIES.find(x => x.country === c)!; return { ...s, fetch: (v: string) => s.fetch(v, `${base}${root}`) }; };
  const run = (c: string, root: string, v: string) => new NationalRegistryAdapter(spec(c, root)).lookup("REG_NO", v, c);

  it("France SIRENE", async () => {
    const r = await run("FR", "/fr", "552 032 534");
    expect(r).toMatchObject({ status: "FOUND", legalName: "DANONE", active: true, source: "fr_sirene" });
    expect((await run("FR", "/fr", "123456789")).status).toBe("NOT_FOUND");
    expect((await run("FR", "/fr", "999999999")).status).toBe("NOT_FOUND"); // placeholder echo with no name
    expect((await run("FR", "/fr", "12")).status).toBe("NOT_FOUND"); // bad format never calls out
  });
  it("Norway Enhetsregisteret", async () => {
    expect(await run("NO", "/no", "923609016")).toMatchObject({ status: "FOUND", legalName: "EQUINOR ASA", active: true });
    expect((await run("NO", "/no", "000000000")).status).toBe("NOT_FOUND");
  });
  it("Czechia ARES, with a dissolved company flagged inactive", async () => {
    expect(await run("CZ", "/cz", "00006947")).toMatchObject({ status: "FOUND", legalName: "Ministerstvo financí", active: true });
    expect((await run("CZ", "/cz", "00000001")).active).toBe(false);
    expect((await run("CZ", "/cz", "99999999")).status).toBe("NOT_FOUND");
  });
  it("Singapore ACRA and Estonia RIK", async () => {
    expect(await run("SG", "/sg", "198600294g")).toMatchObject({ status: "FOUND", active: true });
    expect((await run("SG", "/sg", "200000000A")).status).toBe("NOT_FOUND");
    expect(await run("EE", "/ee", "11120894")).toMatchObject({ status: "FOUND", legalName: "Skype Invest OÜ", active: true });
    expect((await run("EE", "/ee", "99999999")).status).toBe("NOT_FOUND");
  });
  it("an unreachable source is UNAVAILABLE, never a rejection", async () => {
    expect((await run("NO", "/down", "923609016")).status).toBe("UNAVAILABLE");
  });
  it("adapters declare only their own country", () => {
    const a = new NationalRegistryAdapter(NATIONAL_REGISTRIES[0]);
    expect(a.supports("REG_NO", "FR")).toBe(true);
    expect(a.supports("REG_NO", "DE")).toBe(false);
    expect(a.supports("VAT_ID", "FR")).toBe(false);
  });
});
