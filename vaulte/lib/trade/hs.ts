// Harmonized System (HS 2022) lookup and validation, from the vendored open dataset (data/hs2022.csv, see data/README-hs.md).
import { readFileSync } from "fs";
import path from "path";
import { CsvStream } from "@/lib/sanctions/parsers";

export interface HsEntry { code: string; description: string; level: 2 | 4 | 6; section: string; parent: string }

let table: Map<string, HsEntry> | null = null;
let list: HsEntry[] = [];

function load() {
  if (table) return;
  const text = readFileSync(path.join(process.cwd(), "data", "hs2022.csv"), "utf8");
  const rows: string[][] = []; const s = new CsvStream(r => rows.push(r)); s.feed(text); s.end();
  const head = rows[0]; const col = (n: string) => head.indexOf(n);
  table = new Map(); list = [];
  for (const r of rows.slice(1)) {
    const level = Number(r[col("level")]);
    if (![2, 4, 6].includes(level)) continue;
    if (r[col("hscode")].startsWith("99")) continue; // chapter 99 holds statistical placeholder codes (e.g. 999999 "commodities not specified"), not real goods
    const e: HsEntry = { code: r[col("hscode")], description: r[col("description")], level: level as 2 | 4 | 6, section: r[col("section")], parent: r[col("parent")] };
    table.set(e.code, e); list.push(e);
  }
}

/** Digits only: "6203.42" / "6203 42 00" -> "62034200". */
export const normalizeHs = (c: string) => c.replace(/[^0-9]/g, "");

export type HsCheck = { ok: true; code: string; level: 2 | 4 | 6 | 8 | 10; description: string; chapter: string; national_extension: boolean } | { ok: false; reason: string };

/** Valid when the first 6 (or 4) digits exist in HS 2022. 8-10 digit national codes are accepted on that basis only. */
export function validateHs(input: string, opts: { minDigits?: 4 | 6 } = {}): HsCheck {
  load();
  const code = normalizeHs(input);
  if (![4, 6, 8, 10].includes(code.length)) return { ok: false, reason: "An HS code has 4, 6, 8 or 10 digits" };
  const base = table!.get(code.slice(0, code.length >= 6 ? 6 : 4));
  if (!base) return { ok: false, reason: `${code.slice(0, code.length >= 6 ? 6 : 4)} is not a valid HS 2022 ${code.length >= 6 ? "subheading" : "heading"}` };
  if (code.length < (opts.minDigits ?? 4)) return { ok: false, reason: `Use at least ${opts.minDigits} digits` };
  return { ok: true, code, level: code.length as 4 | 6 | 8 | 10, description: base.description, chapter: code.slice(0, 2), national_extension: code.length > 6 };
}

export function lookupHs(code: string): HsEntry | null { load(); return table!.get(normalizeHs(code)) ?? null; }

/** Search by code prefix or by words in the description (all words must match), 6-digit subheadings first. */
export function searchHs(q: string, limit = 20): HsEntry[] {
  load();
  const query = q.trim().toLowerCase();
  if (query.length < 2) return [];
  const digits = normalizeHs(query);
  if (digits.length >= 2 && /^[\d.\s]+$/.test(query)) return list.filter(e => e.code.startsWith(digits)).sort((a, b) => b.level - a.level || a.code.localeCompare(b.code)).slice(0, limit);
  const words = query.split(/[^a-z0-9]+/).filter(w => w.length > 1);
  return list.filter(e => words.every(w => e.description.toLowerCase().includes(w))).sort((a, b) => b.level - a.level || a.code.localeCompare(b.code)).slice(0, limit);
}
export const hsChapterTitle = (chapter: string) => lookupHs(chapter)?.description ?? null;
