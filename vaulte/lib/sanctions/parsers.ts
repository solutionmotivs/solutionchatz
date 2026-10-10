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

/** Incremental RFC 4180 tokenizer: feed text chunks, get each completed row through the callback. Memory stays at one row. */
export class CsvStream {
  private row: string[] = []; private field = ""; private inQ = false; private pendingQuote = false; private first = true;
  constructor(private onRow: (row: string[]) => void) {}
  feed(chunk: string) {
    let s = chunk;
    if (this.first && s.length) { this.first = false; if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); }
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (this.pendingQuote) {          // previous char was a quote inside a quoted field
        this.pendingQuote = false;
        if (c === '"') { this.field += '"'; continue; }
        this.inQ = false;                // it closed the field: fall through and treat c normally
      }
      if (this.inQ) { if (c === '"') this.pendingQuote = true; else this.field += c; }
      else if (c === '"') this.inQ = true;
      else if (c === ",") { this.row.push(this.field); this.field = ""; }
      else if (c === "\n") { this.row.push(this.field); this.onRow(this.row); this.row = []; this.field = ""; }
      else if (c !== "\r") this.field += c;
    }
  }
  end() {
    if (this.pendingQuote) { this.pendingQuote = false; this.inQ = false; }
    if (this.field.length || this.row.length) { this.row.push(this.field); this.onRow(this.row); }
    this.row = []; this.field = "";
  }
}

/** Builds UK entries row by row (only the columns it needs are kept). */
export class UkIngest {
  private h: string[] | null = null;
  private idx = { id: -1, type: -1, reg: -1, des: -1, dob: -1, nat: -1, ctry: -1, names: [] as number[] };
  private byId = new Map<string, ParsedEntry>();
  row(r: string[]) {
    if (!this.h) {
      if (!r.includes("Unique ID")) return; // report-date line(s) before the header
      this.h = r; const col = (n: string) => r.indexOf(n);
      this.idx = { id: col("Unique ID"), type: col("Name type"), reg: col("Regime Name"), des: col("Designation Type"), dob: col("D.O.B"), nat: col("Nationality(/ies)"), ctry: col("Address Country"), names: ["Name 1", "Name 2", "Name 3", "Name 4", "Name 5", "Name 6"].map(col) };
      return;
    }
    const x = this.idx;
    const id = (r[x.id] ?? "").trim();
    if (!id) return;
    const name = x.names.map(c => (r[c] ?? "").trim()).filter(Boolean).join(" ");
    if (!name) return;
    const des = (r[x.des] ?? "").trim().toLowerCase();
    let e = this.byId.get(id);
    if (!e) {
      e = { externalId: id, kind: des === "individual" ? "INDIVIDUAL" : des === "ship" ? "VESSEL" : "ENTITY", name: "", aliases: [], birthYears: [], countries: [], programs: [], addresses: [] };
      this.byId.set(id, e);
    }
    const isPrimary = /^primary name$/i.test((r[x.type] ?? "").trim());
    if (isPrimary && !e.name) e.name = name; else if (name !== e.name) e.aliases.push(name);
    if (r[x.dob]) e.birthYears.push(...years(r[x.dob]));
    if (r[x.nat]) e.countries.push(...r[x.nat].split(/[|;]/).map(v => v.trim().toLowerCase()).filter(Boolean));
    if (r[x.ctry]) e.countries.push(r[x.ctry].trim().toLowerCase());
    if (r[x.reg]) e.programs.push(r[x.reg].trim());
  }
  finish(): ParsedEntry[] {
    if (!this.h) throw new Error("UK list: header row not found");
    return Array.from(this.byId.values()).map(e => ({ ...e, name: e.name || e.aliases[0] || "", aliases: uniq(e.aliases.filter(a => a !== e.name)), birthYears: uniq(e.birthYears), countries: uniq(e.countries), programs: uniq(e.programs) })).filter(e => e.name);
  }
}

export function parseUk(csv: string): ParsedEntry[] {
  const u = new UkIngest(); const t = new CsvStream(r => u.row(r));
  t.feed(csv); t.end();
  return u.finish();
}

/** Streaming variant: feed decoded text chunks as they arrive (a 50 MB list never sits in memory as one string). */
export async function parseUkStream(chunks: AsyncIterable<string>): Promise<ParsedEntry[]> {
  const u = new UkIngest(); const t = new CsvStream(r => u.row(r));
  for await (const c of chunks) t.feed(c);
  t.end();
  return u.finish();
}
