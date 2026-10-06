import http from "node:http";
import { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { canonical, foldDiacritics, jaroWinkler, normalizeName } from "../lib/sanctions/normalize";
import { SanctionsIndex, decide, scoreNames, type IndexEntry } from "../lib/sanctions/match";
import { parseCsv, parseOfac, parseUk, parseUn } from "../lib/sanctions/parsers";
import { addressKey } from "../lib/sanctions/sync";
import { normTokens } from "../lib/sanctions/normalize";

const entry = (id: string, name: string, kind: string, extra: Partial<IndexEntry> & { aliases?: string[] } = {}): IndexEntry => ({
  id, list: "TEST", externalId: id, kind, name, birthYears: [], countries: [], programs: [], ...extra,
  variants: [name, ...(extra.aliases ?? [])].map(t => ({ text: t, tokens: normTokens(t, kind === "INDIVIDUAL" ? "INDIVIDUAL" : "ENTITY"), canon: canonical(t, kind === "INDIVIDUAL" ? "INDIVIDUAL" : "ENTITY") })),
});

describe("normalisation", () => {
  it("folds case, diacritics and special letters", () => {
    expect(foldDiacritics("Müller-Ørsted Łukasz Straße")).toBe("muller-orsted lukasz strasse");
    expect(normalizeName("  Acme, Trading Ltd.  ")).toBe("acme trading");
    expect(normalizeName("Acme Trading L.L.C.")).toBe("acme trading l l c");
  });
  it("ignores token order and company suffixes for canonical comparison", () => {
    expect(canonical("ABBAS, Abu", "INDIVIDUAL")).toBe(canonical("Abu Abbas", "INDIVIDUAL"));
    expect(canonical("Bank Markazi Iran Limited")).toBe(canonical("LIMITED Iran Markazi Bank"));
  });
  it("Jaro-Winkler basics", () => {
    expect(jaroWinkler("martha", "marhta")).toBeGreaterThan(0.96);
    expect(jaroWinkler("abc", "xyz")).toBe(0);
    expect(jaroWinkler("same", "same")).toBe(1);
  });
});

describe("matching and decisions", () => {
  const index = new SanctionsIndex([
    entry("1", "BANK MARKAZI JOMHOURI ISLAMI IRAN", "ENTITY", { aliases: ["CENTRAL BANK OF IRAN", "BANK MARKAZI IRAN"], countries: ["iran"] }),
    entry("2", "ABBAS, Abu", "INDIVIDUAL", { aliases: ["ZAYDAN, Muhammad"], birthYears: [1948] }),
    entry("3", "SMITH, John", "INDIVIDUAL", { birthYears: [1970] }),
    entry("4", "Evergreen Shipping Company Ltd", "ENTITY"),
  ]);
  it("exact entity name (any word order, with suffix noise) is a BLOCK", () => {
    const q = { name: "Iran Markazi Bank Jomhouri Islami", kind: "ENTITY" as const };
    const m = index.search(q);
    expect(m[0].entryId).toBe("1");
    const alias = index.search({ name: "Central Bank of Iran Ltd", kind: "ENTITY" });
    expect(decide(alias, { name: "x", kind: "ENTITY" }).outcome).toBe("BLOCK");
  });
  it("a typo still matches and goes at least to review", () => {
    const q = { name: "Bank Markazi Jomhouri Islamy Iran", kind: "ENTITY" as const };
    const m = index.search(q);
    expect(m[0]?.entryId).toBe("1");
    expect(["REVIEW", "BLOCK"]).toContain(decide(m, q).outcome);
  });
  it("a person's exact name alone is REVIEW; with a matching birth year it is BLOCK; wrong year lowers the score", () => {
    const q1 = { name: "John Smith", kind: "INDIVIDUAL" as const };
    expect(decide(index.search(q1), q1).outcome).toBe("REVIEW");
    const q2 = { name: "John Smith", kind: "INDIVIDUAL" as const, dateOfBirth: "1970-05-05" };
    expect(decide(index.search(q2), q2).outcome).toBe("BLOCK");
    const q3 = { name: "John Smith", kind: "INDIVIDUAL" as const, dateOfBirth: "1985-01-01" };
    expect(index.search(q3)[0].score).toBeLessThan(index.search(q1)[0].score);
    expect(decide(index.search(q3), q3).outcome).toBe("CLEAR");
  });
  it("aliases match; unrelated names are clear", () => {
    expect(index.search({ name: "Muhammad Zaydan", kind: "INDIVIDUAL" })[0]?.entryId).toBe("2");
    for (const n of ["Sunrise Textiles Private Limited", "Priya Natarajan", "Evergreen Valley Farms"]) {
      const q = { name: n, kind: (n.includes("Priya") ? "INDIVIDUAL" : "ENTITY") as "INDIVIDUAL" | "ENTITY" };
      expect(decide(index.search(q), q).outcome).toBe("CLEAR");
    }
  });
  it("a single shared word between multi-word names is not a match", () => {
    expect(scoreNames(["evergreen", "valley", "farms"], "evergreen farms valley", ["evergreen", "shipping"], "evergreen shipping")).toBeLessThan(70);
  });
  it("vessels are never matched against people", () => {
    const idx = new SanctionsIndex([entry("v", "John Smith", "VESSEL")]);
    expect(idx.search({ name: "John Smith", kind: "INDIVIDUAL" })).toEqual([]);
  });
});

describe("list parsers (fixtures in the official formats)", () => {
  it("CSV: quotes, commas, newlines", () => {
    expect(parseCsv('a,"b,c","d ""q""",e\n1,2,"x\ny",4\n')).toEqual([["a", "b,c", 'd "q"', "e"], ["1", "2", "x\ny", "4"]]);
  });
  const sdn = [
    '36,"AEROCARIBBEAN AIRLINES",-0- ,"CUBA",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ',
    '2674,"ABBAS, Abu","individual","SDGT",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"DOB 10 Dec 1948; alt. DOB 1949; POB Tunis, Tunisia; nationality Palestinian; Gender Male"',
    '4632,"BANK MARKAZI",-0- ,"IRAN] [SDGT",-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,-0- ,"Digital Currency Address - TRX TNiq9AXBp9EjUqhDhrwrfvAA8U3GUQZH81; alt. Digital Currency Address - ETH 0xAbCdEf0123456789abcdef0123456789ABCDEF01; Secondary sanctions risk"',
    '9001,"SHIP ONE","vessel","RUSSIA-EO14024",-0- ,-0- ,"Cargo",-0- ,-0- ,"Panama",-0- ,-0- ',
  ].join("\n");
  const alt = '36,12,"aka","AERO-CARIBBEAN",-0- \n2674,5,"aka","ZAYDAN, Muhammad",-0- \n';
  const add = '36,25,-0- ,"Havana","Cuba",-0- \n';
  it("OFAC: types, programs, years, aliases, countries and digital-currency addresses", () => {
    const e = parseOfac(sdn, alt, add);
    expect(e).toHaveLength(4);
    const aero = e.find(x => x.externalId === "36")!;
    expect(aero.kind).toBe("ENTITY");
    expect(aero.aliases).toEqual(["AERO-CARIBBEAN"]);
    expect(aero.countries).toContain("cuba");
    const abbas = e.find(x => x.externalId === "2674")!;
    expect(abbas.kind).toBe("INDIVIDUAL");
    expect(abbas.birthYears.sort()).toEqual([1948, 1949]);
    expect(abbas.countries).toContain("palestinian");
    expect(abbas.aliases).toEqual(["ZAYDAN, Muhammad"]);
    const bank = e.find(x => x.externalId === "4632")!;
    expect(bank.programs).toEqual(["IRAN", "SDGT"]);
    expect(bank.addresses).toEqual([{ asset: "TRX", address: "TNiq9AXBp9EjUqhDhrwrfvAA8U3GUQZH81" }, { asset: "ETH", address: "0xAbCdEf0123456789abcdef0123456789ABCDEF01" }]);
    expect(e.find(x => x.externalId === "9001")!.kind).toBe("VESSEL");
  });
  it("UN XML: individuals, entities, aliases, years", () => {
    const xml = `<?xml version="1.0"?><CONSOLIDATED_LIST><INDIVIDUALS><INDIVIDUAL><DATAID>1</DATAID><FIRST_NAME>ERIC</FIRST_NAME><SECOND_NAME>BADEGE</SECOND_NAME><UN_LIST_TYPE>DRC</UN_LIST_TYPE>
      <INDIVIDUAL_ALIAS><ALIAS_NAME>Eric B</ALIAS_NAME></INDIVIDUAL_ALIAS><INDIVIDUAL_DATE_OF_BIRTH><YEAR>1971</YEAR></INDIVIDUAL_DATE_OF_BIRTH><NATIONALITY><VALUE>Rwanda</VALUE></NATIONALITY></INDIVIDUAL></INDIVIDUALS>
      <ENTITIES><ENTITY><DATAID>2</DATAID><FIRST_NAME>ADF</FIRST_NAME><ENTITY_ALIAS><ALIAS_NAME>NALU</ALIAS_NAME></ENTITY_ALIAS></ENTITY></ENTITIES></CONSOLIDATED_LIST>`;
    const e = parseUn(xml);
    expect(e).toHaveLength(2);
    expect(e[0]).toMatchObject({ name: "ERIC BADEGE", kind: "INDIVIDUAL", aliases: ["Eric B"], birthYears: [1971], countries: ["rwanda"] });
    expect(e[1]).toMatchObject({ name: "ADF", kind: "ENTITY", aliases: ["NALU"] });
  });
  it("UK CSV: groups rows per unique id, primary name vs aliases", () => {
    const head = "Last Updated,Unique ID,OFSI Group ID,UN Reference Number,Name 6,Name 1,Name 2,Name 3,Name 4,Name 5,Name type,Alias strength,Title,Name non-latin script,Non-latin script type,Non-latin script language,Regime Name,Designation Type,Designation source,Sanctions Imposed,Other Information,UK Statement of Reasons,Address Line 1,Address Line 2,Address Line 3,Address Line 4,Address Line 5,Address Line 6,Address Postal Code,Address Country,Phone number,Website,Email address,Date Designated,D.O.B,Nationality(/ies)";
    const csv = `Report Date: 02-Oct-2026\n${head}\n` +
      `04/08/2026,UKX1,1,,HASSAN,Ali,,,,,Primary name,,,,,,Counter Terrorism,Individual,UK,,,,,,,,,,,Syria,,,,01/01/2020,00/00/1975,Syria\n` +
      `04/08/2026,UKX1,1,,HASSAN,Aly,,,,,Alias,Good quality,,,,,Counter Terrorism,Individual,UK,,,,,,,,,,,Syria,,,,01/01/2020,00/00/1975,Syria\n` +
      `04/08/2026,UKX2,2,,ACME TRADING FZE,,,,,,Primary name,,,,,,Russia,Entity,UK,,,,,,,,,,,UAE,,,,01/01/2022,,\n`;
    const e = parseUk(csv);
    expect(e).toHaveLength(2);
    expect(e[0]).toMatchObject({ externalId: "UKX1", kind: "INDIVIDUAL", name: "Ali HASSAN", aliases: ["Aly HASSAN"], birthYears: [1975], programs: ["Counter Terrorism"] });
    expect(e[1]).toMatchObject({ kind: "ENTITY", name: "ACME TRADING FZE" });
  });
  it("addresses: hex addresses are case-insensitive, other chains are exact", () => {
    expect(addressKey("0xAbCdEf0123456789abcdef0123456789ABCDEF01")).toBe("0xabcdef0123456789abcdef0123456789abcdef01");
    expect(addressKey(" TNiq9AXBp9EjUqhDhrwrfvAA8U3GUQZH81 ")).toBe("TNiq9AXBp9EjUqhDhrwrfvAA8U3GUQZH81");
  });
});

describe("live official lists (runs only when the files were downloaded to /var/tmp/lists)", () => {
  const dir = "/var/tmp/lists/";
  const have = require("node:fs").existsSync(dir + "sdn.csv");
  (have ? it : it.skip)("parses all three lists and finds known designations", () => {
    const fs = require("node:fs");
    const ofac = parseOfac(fs.readFileSync(dir + "sdn.csv", "utf8"), fs.readFileSync(dir + "alt.csv", "utf8"), fs.readFileSync(dir + "add.csv", "utf8"));
    expect(ofac.length).toBeGreaterThan(10000);
    expect(ofac.flatMap(e => e.addresses).length).toBeGreaterThan(100);
    const un = parseUn(fs.readFileSync(dir + "consolidated.xml", "utf8"));
    expect(un.length).toBeGreaterThan(500);
    const uk = parseUk(fs.readFileSync(dir + "UK-Sanctions-List.csv", "utf8"));
    expect(uk.length).toBeGreaterThan(3000);
    const idx = new SanctionsIndex([...ofac, ...un, ...uk].map((e, i) => entry(String(i), e.name, e.kind, { aliases: e.aliases, birthYears: e.birthYears, countries: e.countries, programs: e.programs })));
    const q = { name: "Central Bank of Iran", kind: "ENTITY" as const };
    expect(decide(idx.search(q), q).outcome).toBe("BLOCK");
    const ok = { name: "Sunrise Textiles Private Limited", kind: "ENTITY" as const };
    expect(decide(idx.search(ok), ok).outcome).toBe("CLEAR");
    // Ordinary Indian business and personal names must not be flooded with alerts.
    const common = ["Tata Consultancy Services", "Infosys Limited", "Reliance Industries", "Asha Rao", "Vikram Sethi", "Priya Natarajan", "Rahul Sharma"];
    const flagged = common.filter(n => decide(idx.search({ name: n, kind: /\s(limited|services|industries)/i.test(n) ? "ENTITY" : "INDIVIDUAL" }), { name: n }).outcome !== "CLEAR");
    expect(flagged).toEqual([]);
  }, 120000);
});

describe("single-word names", () => {
  it("are not fuzzy-matched on one letter", () => {
    const idx = new SanctionsIndex([entry("b", "BERING", "ENTITY")]);
    const q = { name: "Berlin GmbH", kind: "ENTITY" as const };
    expect(decide(idx.search(q), q).outcome).toBe("CLEAR");
    const same = { name: "Bering Ltd", kind: "ENTITY" as const };
    expect(decide(idx.search(same), same).outcome).toBe("BLOCK");
  });
});

describe("wallet screening: optional Chainalysis source (against a stub)", () => {
  it("uses the X-API-Key header and treats identifications as sanctioned", async () => {
    const seen: http.IncomingHttpHeaders[] = [];
    const srv = http.createServer((req, res) => {
      seen.push(req.headers);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(req.url!.endsWith("/0xbad") ? { identifications: [{ category: "sanctions", name: "SANCTIONS: Example" }] } : { identifications: [] }));
    });
    await new Promise<void>(r => srv.listen(0, "127.0.0.1", r));
    process.env.CHAINALYSIS_API_KEY = "k"; process.env.CHAINALYSIS_BASE_URL = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/v1/address`;
    const { externalWalletCheck } = await import("../lib/sanctions/screen");
    const bad = await externalWalletCheck("0xbad");
    expect(bad).toMatchObject({ sanctioned: true, source: "chainalysis" });
    expect((await externalWalletCheck("0xgood"))?.sanctioned).toBe(false);
    expect(seen[0]["x-api-key"]).toBe("k");
    delete process.env.CHAINALYSIS_API_KEY; delete process.env.CHAINALYSIS_BASE_URL;
    srv.close();
  });
});

import { CsvStream, parseUkStream } from "../lib/sanctions/parsers";
describe("streaming CSV (UK list is 50 MB: it must never be one string)", () => {
  const tricky = 'a,b,c\r\n"x, y",2,"he said ""hi"""\n"multi\nline",,\n1,2,3\nlast,"q"';
  const collect = (chunk: number) => { const rows: string[][] = []; const s = new CsvStream(r => rows.push(r)); for (let i = 0; i < tricky.length; i += chunk) s.feed(tricky.slice(i, i + chunk)); s.end(); return rows; };
  it("gives the same rows as the whole-string parser at every chunk size (quotes split across chunks included)", () => {
    const want = parseCsv(tricky);
    for (const n of [1, 2, 3, 5, 7, 13, tricky.length]) expect(collect(n), `chunk ${n}`).toEqual(want);
  });
  it("UK stream parse equals the string parse, with a BOM and chunks of 1 to 50 characters", async () => {
    const head = "Last Updated,Unique ID,OFSI Group ID,UN Reference Number,Name 6,Name 1,Name 2,Name 3,Name 4,Name 5,Name type,Alias strength,Title,Name non-latin script,Non-latin script type,Non-latin script language,Regime Name,Designation Type,Designation source,Sanctions Imposed,Other Information,UK Statement of Reasons,Address Line 1,Address Line 2,Address Line 3,Address Line 4,Address Line 5,Address Line 6,Address Postal Code,Address Country,Phone number,Website,Email address,Date Designated,D.O.B,Nationality(/ies)";
    const csv = "﻿Report Date: 02-Oct-2026\n" + head + "\n" +
      '04/08/2026,UKX1,1,,HASSAN,Ali,,,,,Primary name,,,,,,Counter Terrorism,Individual,UK,,"reason, with ""quotes""\nand a newline",,,,,,,,Syria,,,,01/01/2020,00/00/1975,Syria\n' +
      "04/08/2026,UKX1,1,,HASSAN,Aly,,,,,Alias,Good quality,,,,,Counter Terrorism,Individual,UK,,,,,,,,,,,Syria,,,,01/01/2020,00/00/1975,Syria\n" +
      "04/08/2026,UKX2,2,,ACME TRADING FZE,,,,,,Primary name,,,,,,Russia,Entity,UK,,,,,,,,,,,UAE,,,,01/01/2022,,\n";
    const want = parseUk(csv);
    expect(want.map(e => e.externalId)).toEqual(["UKX1", "UKX2"]);
    for (const n of [1, 10, 50, csv.length]) {
      async function* gen() { for (let i = 0; i < csv.length; i += n) yield csv.slice(i, i + n); }
      expect(await parseUkStream(gen()), `chunk ${n}`).toEqual(want);
    }
    await expect(parseUkStream((async function* () { yield "no header here\n1,2\n"; })())).rejects.toThrow(/header row not found/);
  });
});
