// Parsers for the official list formats: OFAC SDN (csv: sdn/alt/add), UN consolidated (xml), UK sanctions list (csv).
import { XMLParser } from "fast-xml-parser";

export interface ParsedEntry {
  externalId: string;
  kind: "INDIVIDUAL" | "ENTITY" | "VESSEL" | "OTHER";
  name: string;
  aliases: string[];
  birthYears: number[];
  countries: string[];
  programs: string[];
  addresses: { asset: string; address: string }[];
}

/** RFC 4180 CSV (quoted fields, embedded commas, quotes and newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* ignore */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const clean = (v: string | undefined) => { const t = (v ?? "").trim(); return t === "-0-" ? "" : t; };
const years = (s: string) => Array.from(s.matchAll(/\b(1[89]\d{2}|20[0-2]\d)\b/g)).map(m => Number(m[1]));
const uniq = <T,>(a: T[]) => Array.from(new Set(a));

const DCA = /(?:alt\.\s*)?Digital Currency Address - ([A-Za-z0-9]+)\s+([A-Za-z0-9]{20,})/g;

export function parseOfac(sdnCsv: string, altCsv: string, addCsv: string): ParsedEntry[] {
  const byId = new Map<string, ParsedEntry>();
  for (const r of parseCsv(sdnCsv)) {
    if (r.length < 4 || !/^\d+$/.test(r[0].trim())) continue;
    const type = clean(r[2]).toLowerCase();
    const remarks = r.slice(11).join(",");
    const dob = Array.from(remarks.matchAll(/DOB ([^;]+)/g)).flatMap(m => years(m[1]));
    const nat = Array.from(remarks.matchAll(/(?:nationality|citizen)\s+([^;]+)/gi)).map(m => m[1].trim().toLowerCase());
    byId.set(r[0].trim(), {
      externalId: r[0].trim(),
      kind: type === "individual" ? "INDIVIDUAL" : type === "vessel" ? "VESSEL" : type === "aircraft" ? "OTHER" : "ENTITY",
      name: clean(r[1]), aliases: [], birthYears: uniq(dob), countries: uniq(nat),
      programs: clean(r[3]).split(/\]\s*\[/).map(p => p.replace(/[\[\]]/g, "").trim()).filter(Boolean),
      addresses: Array.from(remarks.matchAll(DCA)).map(m => ({ asset: m[1].toUpperCase(), address: m[2] })),
    });
  }
  for (const r of parseCsv(altCsv)) {
    const e = byId.get((r[0] ?? "").trim());
    const n = clean(r[3]);
    if (e && n) e.aliases.push(n);
  }
  for (const r of parseCsv(addCsv)) {
    const e = byId.get((r[0] ?? "").trim());
    const c = clean(r[4]);
    if (e && c) e.countries.push(c.toLowerCase());
  }
  return Array.from(byId.values()).map(e => ({ ...e, aliases: uniq(e.aliases), countries: uniq(e.countries) }));
}

export function parseUn(xml: string): ParsedEntry[] {
  const p = new XMLParser({ ignoreAttributes: true, parseTagValue: false, isArray: n => ["INDIVIDUAL", "ENTITY", "INDIVIDUAL_ALIAS", "ENTITY_ALIAS", "INDIVIDUAL_ADDRESS", "ENTITY_ADDRESS", "INDIVIDUAL_DATE_OF_BIRTH", "NATIONALITY", "VALUE"].includes(n) });
  const doc = p.parse(xml);
  const root = doc.CONSOLIDATED_LIST ?? {};
  const out: ParsedEntry[] = [];
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  for (const i of root.INDIVIDUALS?.INDIVIDUAL ?? []) {
    const name = [i.FIRST_NAME, i.SECOND_NAME, i.THIRD_NAME, i.FOURTH_NAME].map(str).filter(Boolean).join(" ");
    const by = (i.INDIVIDUAL_DATE_OF_BIRTH ?? []).flatMap((d: any) => [str(d.YEAR), str(d.FROM_YEAR), str(d.TO_YEAR), str(d.DATE)].flatMap(x => years(x)));
    out.push({
      externalId: str(i.DATAID) || str(i.REFERENCE_NUMBER), kind: "INDIVIDUAL", name,
      aliases: uniq((i.INDIVIDUAL_ALIAS ?? []).map((a: any) => str(a.ALIAS_NAME)).filter(Boolean)),
      birthYears: uniq(by),
      countries: uniq([...(i.NATIONALITY ?? []).flatMap((n: any) => (n.VALUE ?? []).map((v: unknown) => str(v).toLowerCase())), ...(i.INDIVIDUAL_ADDRESS ?? []).map((a: any) => str(a.COUNTRY).toLowerCase())].filter(Boolean)),
      programs: [str(i.UN_LIST_TYPE)].filter(Boolean), addresses: [],
    });
  }
  for (const e of root.ENTITIES?.ENTITY ?? []) {
    out.push({
      externalId: str(e.DATAID) || str(e.REFERENCE_NUMBER), kind: "ENTITY", name: str(e.FIRST_NAME),
      aliases: uniq((e.ENTITY_ALIAS ?? []).map((a: any) => str(a.ALIAS_NAME)).filter(Boolean)), birthYears: [],
      countries: uniq((e.ENTITY_ADDRESS ?? []).map((a: any) => str(a.COUNTRY).toLowerCase()).filter(Boolean)),
      programs: [str(e.UN_LIST_TYPE)].filter(Boolean), addresses: [],
    });
  }
  return out.filter(e => e.externalId && e.name);
}

export function parseUk(csv: string): ParsedEntry[] {
  const rows = parseCsv(csv);
  // Row 0 is the report date line; the header is the first row containing "Unique ID".
  const hi = rows.findIndex(r => r.includes("Unique ID"));
  if (hi < 0) throw new Error("UK list: header row not found");
  const h = rows[hi];
  const col = (n: string) => h.indexOf(n);
  const [cId, cType, cReg, cDes, cDob, cNat, cCtry] = [col("Unique ID"), col("Name type"), col("Regime Name"), col("Designation Type"), col("D.O.B"), col("Nationality(/ies)"), col("Address Country")];
  const nameCols = ["Name 1", "Name 2", "Name 3", "Name 4", "Name 5", "Name 6"].map(col);
  const byId = new Map<string, ParsedEntry>();
  for (const r of rows.slice(hi + 1)) {
    const id = (r[cId] ?? "").trim();
    if (!id) continue;
    const name = nameCols.map(c => (r[c] ?? "").trim()).filter(Boolean).join(" ");
    if (!name) continue;
    const des = (r[cDes] ?? "").trim().toLowerCase();
    let e = byId.get(id);
    if (!e) {
      e = { externalId: id, kind: des === "individual" ? "INDIVIDUAL" : des === "ship" ? "VESSEL" : "ENTITY", name: "", aliases: [], birthYears: [], countries: [], programs: [], addresses: [] };
      byId.set(id, e);
    }
    const isPrimary = /^primary name$/i.test((r[cType] ?? "").trim());
    if (isPrimary && !e.name) e.name = name; else if (name !== e.name) e.aliases.push(name);
    if (r[cDob]) e.birthYears.push(...years(r[cDob]));
    if (r[cNat]) e.countries.push(...r[cNat].split(/[|;]/).map(x => x.trim().toLowerCase()).filter(Boolean));
    if (r[cCtry]) e.countries.push(r[cCtry].trim().toLowerCase());
    if (r[cReg]) e.programs.push(r[cReg].trim());
  }
  return Array.from(byId.values()).map(e => ({ ...e, name: e.name || e.aliases[0] || "", aliases: uniq(e.aliases.filter(a => a !== e.name)), birthYears: uniq(e.birthYears), countries: uniq(e.countries), programs: uniq(e.programs) })).filter(e => e.name);
}
