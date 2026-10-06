// Invoice arithmetic in integer minor units. Tax is computed per line and rounded per line (so the PDF, the pay page and the API always agree).
export interface LineInput { description: string; quantity: number; unit_price: number; tax_rate: number; hs_code?: string | null }
export interface LineOut extends LineInput { net: number; tax: number; total: number }

export function computeLines(lines: LineInput[]): { lines: LineOut[]; subtotal: number; tax: number; total: number; taxByRate: { rate: number; net: number; tax: number }[] } {
  const out = lines.map(l => {
    const net = Math.round(l.quantity * l.unit_price);
    const tax = Math.round(net * (l.tax_rate / 100));
    return { ...l, net, tax, total: net + tax };
  });
  const byRate = new Map<number, { rate: number; net: number; tax: number }>();
  for (const l of out) { const r = byRate.get(l.tax_rate) ?? { rate: l.tax_rate, net: 0, tax: 0 }; r.net += l.net; r.tax += l.tax; byRate.set(l.tax_rate, r); }
  const subtotal = out.reduce((s, l) => s + l.net, 0), tax = out.reduce((s, l) => s + l.tax, 0);
  return { lines: out, subtotal, tax, total: subtotal + tax, taxByRate: [...byRate.values()].sort((a, b) => a.rate - b.rate) };
}

export const PREFIX = { INVOICE: "INV", PROFORMA: "PF", LINK: "PL", CHECKOUT: "CO" } as const;

/** INV-2026-0001: sequential per organisation and kind within a year. */
export function formatNumber(prefix: string, year: number, seq: number): string {
  return `${prefix}-${year}-${String(seq).padStart(4, "0")}`;
}

/** https only (http allowed for localhost in development); no credentials in the URL. */
export function safeReturnUrl(u: string | undefined | null): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    if (url.username || url.password) return null;
    const local = ["localhost", "127.0.0.1"].includes(url.hostname) && process.env.NODE_ENV !== "production";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
    return url.toString();
  } catch { return null; }
}
