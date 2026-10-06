// Pricing: Vaulte's markup on top of firm partner costs, with a floor so a quote can never lose money.
import type { CostBreakdown, RateTable, Route, TransferKindT } from "@/lib/stablecoin/types";
import { minorToMajor } from "@/lib/currency";
import { routeCostUsd } from "@/lib/routing/engine";

export interface MarkupTier {
  /** applies when transfer USD amount is < upTo (Infinity for the last tier) */
  upToUsd: number;
  bps: number;
}

/** Default markup tiers (basis points). Configure per deployment; these are starting points. */
export const MARKUP_TIERS: Record<TransferKindT, MarkupTier[]> = {
  BUSINESS: [
    { upToUsd: 10_000, bps: 40 },
    { upToUsd: 100_000, bps: 30 },
    { upToUsd: 1_000_000, bps: 20 },
    { upToUsd: Infinity, bps: 12 },
  ],
  PERSONAL: [
    { upToUsd: 500, bps: 90 },
    { upToUsd: 2_500, bps: 70 },
    { upToUsd: Infinity, bps: 50 },
  ],
};

/** Minimum Vaulte margin in bps; a quote is rejected if the markup is below this. */
export const MIN_MARGIN_BPS = 8;
/** Safety ceiling for total customer cost; anything above is almost certainly a pricing bug. */
export const MAX_TOTAL_COST_BPS = 300;
/** Typical bank wire cost used only for the on-screen comparison (estimate, labelled as such). */
export const BANK_WIRE_ESTIMATE = { fixedUsd: 30, spreadBps: 250 };

/**
 * Per-corridor markup overrides, configured by the operator (not hard-coded): env MARKUP_BPS_CORRIDORS =
 * [{"from":"US","to":"IN","kind":"BUSINESS","bps":18}] ("*" matches any). The most specific match wins; the minimum margin floor still applies.
 */
export interface CorridorMarkup { from?: string; to?: string; kind?: TransferKindT | "*"; bps: number }
export function corridorMarkups(env: NodeJS.ProcessEnv = process.env): CorridorMarkup[] {
  try { const j = JSON.parse(env.MARKUP_BPS_CORRIDORS ?? "[]"); return Array.isArray(j) ? j.filter(x => Number.isFinite(x?.bps) && x.bps >= 0 && x.bps <= 300) : []; } catch { return []; }
}

export function markupBpsFor(kind: TransferKindT, amountUsd: number, tiers = MARKUP_TIERS, corridor?: { origin: string; dest: string }, overrides = corridorMarkups()): number {
  if (corridor) {
    const m = overrides
      .filter(o => (!o.from || o.from === "*" || o.from === corridor.origin) && (!o.to || o.to === "*" || o.to === corridor.dest) && (!o.kind || o.kind === "*" || o.kind === kind))
      .sort((a, b) => score(b) - score(a))[0];
    if (m) return Math.max(m.bps, MIN_MARGIN_BPS);
  }
  const list = tiers[kind];
  const tier = list.find(t => amountUsd < t.upToUsd) ?? list[list.length - 1];
  return Math.max(tier.bps, MIN_MARGIN_BPS);
}

const score = (o: CorridorMarkup) => (o.from && o.from !== "*" ? 2 : 0) + (o.to && o.to !== "*" ? 2 : 0) + (o.kind && o.kind !== "*" ? 1 : 0);

export function toUsd(minor: number, currency: string, rates: RateTable): number {
  const rate = rates[currency];
  if (!rate) throw new Error(`No FX rate for ${currency}`);
  return minorToMajor(minor, currency) / rate;
}

export function fromUsd(usd: number, currency: string, rates: RateTable): number {
  const rate = rates[currency];
  if (!rate) throw new Error(`No FX rate for ${currency}`);
  return usd * rate;
}

export function buildBreakdown(opts: {
  route: Route;
  kind: TransferKindT;
  sourceCurrency: string;
  destCurrency: string;
  sourceAmountMinor: number;
  rates: RateTable;
  markupBps?: number;
}): CostBreakdown {
  const { route, kind, sourceCurrency, destCurrency, sourceAmountMinor, rates } = opts;
  const amountUsd = toUsd(sourceAmountMinor, sourceCurrency, rates);
  const markupBps = Math.max(opts.markupBps ?? markupBpsFor(kind, amountUsd), MIN_MARGIN_BPS);

  const partnerSpreadUsd = (amountUsd * route.spreadBps) / 10_000;
  const partnerPctFeeUsd = (amountUsd * route.feeBps) / 10_000;
  const networkFeeUsd = route.fixedFeeUsd;
  const partnerCostUsd = routeCostUsd(route, amountUsd);
  const markupUsd = (amountUsd * markupBps) / 10_000;
  const totalCostUsd = partnerCostUsd + markupUsd;
  const destAmountUsd = amountUsd - totalCostUsd;

  const bank = BANK_WIRE_ESTIMATE.fixedUsd + (amountUsd * BANK_WIRE_ESTIMATE.spreadBps) / 10_000;

  return {
    sourceCurrency,
    destCurrency,
    sourceAmountUsd: round(amountUsd),
    midRateSourcePerUsd: rates[sourceCurrency],
    midRateDestPerUsd: rates[destCurrency],
    partnerSpreadUsd: round(partnerSpreadUsd),
    partnerFeeUsd: round(partnerPctFeeUsd),
    networkFeeUsd: round(networkFeeUsd),
    partnerCostUsd: round(partnerCostUsd),
    markupBps,
    markupUsd: round(markupUsd),
    totalCostUsd: round(totalCostUsd),
    totalCostBps: round((totalCostUsd / amountUsd) * 10_000),
    destAmountUsd: round(destAmountUsd),
    bankWireEstimateCostUsd: round(bank),
    savingsVsBankUsd: round(bank - totalCostUsd),
  };
}

export function validateMargin(b: CostBreakdown): { ok: boolean; reason?: string } {
  if (b.destAmountUsd <= 0) return { ok: false, reason: "Amount too small to cover fees" };
  if (b.markupBps < MIN_MARGIN_BPS) return { ok: false, reason: "Markup below minimum margin" };
  if (b.totalCostBps > MAX_TOTAL_COST_BPS) return { ok: false, reason: "Total cost exceeds safety ceiling" };
  return { ok: true };
}

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
