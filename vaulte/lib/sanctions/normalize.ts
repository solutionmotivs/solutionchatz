// Name normalisation for sanctions matching: case, diacritics, punctuation, common transliterations, company suffixes.

const TRANSLIT: Record<string, string> = { "ß": "ss", "ø": "o", "æ": "ae", "œ": "oe", "đ": "d", "ð": "d", "þ": "th", "ł": "l", "ı": "i", "ʻ": "", "ʼ": "", "’": "", "‘": "" };

/** Legal-form words that carry no identity ("Acme Trading LLC" vs "Acme Trading Limited"). */
const COMPANY_NOISE = new Set([
  "ltd", "limited", "llc", "inc", "incorporated", "corp", "corporation", "co", "company", "plc", "pvt", "private", "pte", "gmbh", "ag", "sa", "sarl", "srl",
  "bv", "nv", "oy", "ab", "as", "jsc", "ojsc", "cjsc", "pjsc", "ooo", "oao", "zao", "llp", "lp", "fze", "fzco", "fzc", "dmcc", "the", "of", "and", "de", "al",
]);

export function foldDiacritics(s: string): string {
  const mapped = Array.from(s.toLowerCase()).map(c => TRANSLIT[c] ?? c).join("");
  return mapped.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

export function tokens(name: string): string[] {
  return foldDiacritics(name).replace(/[^a-z0-9Ѐ-ӿ؀-ۿ一-鿿ऀ-ॿ ]+/g, " ").split(/\s+/).filter(Boolean);
}

const LONG_NOISE = Array.from(COMPANY_NOISE).filter(w => w.length >= 5);
/** A legal-form word, including a misspelling of a long one ("compay", "limted"). */
function isNoise(t: string): boolean {
  if (COMPANY_NOISE.has(t)) return true;
  return t.length >= 5 && LONG_NOISE.some(w => Math.abs(w.length - t.length) <= 2 && jaroWinkler(t, w) >= 0.9);
}

/** Normalised, noise-free tokens (kept as-is if removing noise would leave nothing). */
export function normTokens(name: string, kind: "INDIVIDUAL" | "ENTITY" | "OTHER" = "ENTITY"): string[] {
  const t = tokens(name);
  if (kind === "INDIVIDUAL") return t;
  const f = t.filter(x => !isNoise(x));
  return f.length ? f : t;
}

/** Canonical string used for exact comparison: sorted tokens. */
export function canonical(name: string, kind: "INDIVIDUAL" | "ENTITY" | "OTHER" = "ENTITY"): string {
  return [...normTokens(name, kind)].sort().join(" ");
}

export function normalizeName(name: string, kind: "INDIVIDUAL" | "ENTITY" | "OTHER" = "ENTITY"): string {
  return normTokens(name, kind).join(" ");
}

/** Jaro-Winkler similarity in [0,1]. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length ? 1 : 0;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false);
  const bm = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range), hi = Math.min(b.length - 1, i + range);
    for (let j = lo; j <= hi; j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true; matches++; break;
    }
  }
  if (!matches) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - t / 2) / m) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) { if (a[i] === b[i]) prefix++; else break; }
  return jaro + prefix * 0.1 * (1 - jaro);
}
