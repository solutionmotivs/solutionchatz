// Fuzzy name matching against sanctions entries. Scores are 0-100.
//
// Policy (deliberately conservative about auto-blocking, to avoid wrongly freezing common names):
//   BLOCK  : wallet address match; or entity name matches (score >= BLOCK_SCORE); or a person's name matches AND
//            the date of birth (year) is consistent with the listing.
//   REVIEW : any other candidate scoring >= REVIEW_SCORE (staff decide: false positive or confirmed).
//   CLEAR  : nothing at or above REVIEW_SCORE.
import { canonical, jaroWinkler, normTokens } from "./normalize";

export interface IndexEntry {
  id: string;
  list: string;
  externalId: string;
  kind: string;
  name: string;
  /** One normalised variant per primary name / alias. */
  variants: { text: string; tokens: string[]; canon: string }[];
  birthYears: number[];
  countries: string[];
  programs: string[];
}

export interface Query {
  name: string;
  kind?: "INDIVIDUAL" | "ENTITY";
  country?: string;
  /** YYYY-MM-DD, YYYY or DD/MM/YYYY */
  dateOfBirth?: string;
}

export interface Match {
  entryId: string;
  list: string;
  externalId: string;
  listedName: string;
  matchedVariant: string;
  kind: string;
  score: number;
  dobConsistent: boolean | null;
  countryMatch: boolean;
  programs: string[];
}

export type Outcome = "CLEAR" | "REVIEW" | "BLOCK";

export function thresholds() {
  return {
    review: Number(process.env.SANCTIONS_REVIEW_SCORE ?? 88),
    block: Number(process.env.SANCTIONS_BLOCK_SCORE ?? 96),
  };
}

export class SanctionsIndex {
  private byToken = new Map<string, number[]>();
  constructor(public entries: IndexEntry[]) {
    entries.forEach((e, i) => {
      const seen = new Set<string>();
      for (const v of e.variants) for (const t of v.tokens) {
        if (t.length < 3 || seen.has(t)) continue;
        seen.add(t);
        const arr = this.byToken.get(t);
        if (arr) arr.push(i); else this.byToken.set(t, [i]);
      }
    });
  }

  /** Candidate entries sharing at least one token (or a token within a small edit distance of a long query token). */
  private candidates(qTokens: string[]): Set<number> {
    const out = new Set<number>();
    for (const t of qTokens) {
      if (t.length < 3) continue;
      const exact = this.byToken.get(t);
      if (exact) for (const i of exact) out.add(i);
      if (t.length >= 5) {
        // typo tolerance: compare against index tokens of similar length and the same first letter
        for (const [k, idx] of Array.from(this.byToken)) {
          if (k[0] !== t[0] || Math.abs(k.length - t.length) > 2 || k === t) continue;
          if (jaroWinkler(t, k) >= 0.92) for (const i of idx) out.add(i);
        }
      }
    }
    return out;
  }

  search(q: Query): Match[] {
    const kind = q.kind ?? "ENTITY";
    const qt = normTokens(q.name, kind);
    if (!qt.length) return [];
    const qCanon = canonical(q.name, kind);
    const qYear = parseYear(q.dateOfBirth);
    const qCountry = q.country?.toLowerCase();
    const out: Match[] = [];
    for (const idx of Array.from(this.candidates(qt))) {
      const e = this.entries[idx];
      if (kind === "INDIVIDUAL" && e.kind === "VESSEL") continue;
      let best = { score: 0, variant: "" };
      for (const v of e.variants) {
        const s = scoreNames(qt, qCanon, v.tokens, v.canon);
        if (s > best.score) best = { score: s, variant: v.text };
      }
      if (best.score < 70) continue;
      let dobConsistent: boolean | null = null;
      if (qYear && e.birthYears.length) dobConsistent = e.birthYears.includes(qYear);
      const countryMatch = !!qCountry && e.countries.includes(qCountry);
      let score = best.score;
      if (dobConsistent === true) score = Math.min(100, score + 4);
      if (dobConsistent === false) score -= 15;
      if (countryMatch) score = Math.min(100, score + 2);
      out.push({ entryId: e.id, list: e.list, externalId: e.externalId, listedName: e.name, matchedVariant: best.variant, kind: e.kind, score: Math.round(score), dobConsistent, countryMatch, programs: e.programs });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 10);
  }
}

export function parseYear(d?: string): number | null {
  if (!d) return null;
  const m = /(\d{4})/.exec(d);
  return m ? Number(m[1]) : null;
}

/** Token-aware similarity: exact canonical match = 100; otherwise blend whole-string and per-token fuzzy scores. */
export function scoreNames(qt: string[], qCanon: string, ct: string[], cCanon: string): number {
  if (qCanon === cCanon) return 100;
  // One-word names ("Berlin" vs "Bering") are too ambiguous for fuzzy matching: accept only near-identical long words.
  if (qt.length === 1 || ct.length === 1) {
    if (qt.length === 1 && ct.length === 1) {
      const j = jaroWinkler(qt[0], ct[0]);
      return qt[0].length >= 7 && ct[0].length >= 7 && j >= 0.97 ? Math.round(j * 100) : Math.min(60, Math.round(j * 60));
    }
    return 0;
  }
  // Per-token best matches (each candidate token used once).
  const used = new Set<number>();
  let matched = 0;
  for (const a of qt) {
    let bestJ = 0, bestK = -1;
    ct.forEach((b, k) => {
      if (used.has(k)) return;
      const j = a === b ? 1 : jaroWinkler(a, b);
      if (j > bestJ) { bestJ = j; bestK = k; }
    });
    if (bestK >= 0 && bestJ >= 0.88) { used.add(bestK); matched += bestJ; }
  }
  const coverage = (2 * matched) / (qt.length + ct.length);
  const whole = jaroWinkler([...qt].sort().join(" "), [...ct].sort().join(" "));
  // A single shared token between multi-token names is not a match.
  if (Math.min(qt.length, ct.length) >= 2 && used.size < 2) return Math.min(60, coverage * 100);
  return Math.round((0.6 * coverage + 0.4 * whole) * 100);
}

export function decide(matches: Match[], q: Query): { outcome: Outcome; top: number } {
  const { review, block } = thresholds();
  const top = matches[0]?.score ?? 0;
  if (top < review) return { outcome: "CLEAR", top };
  const kind = q.kind ?? "ENTITY";
  const strong = matches.filter(m => m.score >= block);
  const hardBlock = strong.some(m => (kind === "ENTITY" && m.kind !== "INDIVIDUAL") || (m.dobConsistent === true));
  return { outcome: hardBlock ? "BLOCK" : "REVIEW", top };
}
