// FX aggregator: ask every enabled provider for a firm quote, turn each into a routable leg, and let the route engine
// pick the cheapest. Providers: Airwallex (when configured) and the sandbox desks (development only).
import { minorToMajor } from "@/lib/currency";
import type { Leg, FxSummary, TransferKindT } from "@/lib/stablecoin/types";
import { airwallexFxProvider } from "./providers/airwallex";
import { currencycloudFxProvider } from "./providers/currencycloud";
import { wiseFxProvider } from "./providers/wise";
import { MockFxDesk } from "./providers/mock";
import type { FxProvider, FxQuote } from "./providers/types";
import { providerStructure } from "@/lib/routing/structure";

let overrideProviders: FxProvider[] | null = null;
export function setFxProvidersForTests(p: FxProvider[] | null) { overrideProviders = p; }

/** FX_PROVIDERS = comma list of: airwallex, currencycloud, wise, mock. Default: airwallex if keyed, plus mock outside production. */
export function fxProviders(sandbox = true): FxProvider[] {
  if (overrideProviders) return overrideProviders;
  const want = (process.env.FX_PROVIDERS ?? "airwallex,currencycloud,wise,mock").split(",").map(s => s.trim());
  const out: FxProvider[] = [];
  // Test mode never touches live money: Airwallex is used only when its environment matches the mode (sandbox keys in test mode, live keys in live mode).
  const awxLive = process.env.AIRWALLEX_ENV === "live";
  if (want.includes("airwallex") && sandbox !== awxLive) { const a = airwallexFxProvider(); if (a) out.push(a); }
  if (want.includes("currencycloud") && sandbox !== (process.env.CURRENCYCLOUD_ENV === "live")) { const c = currencycloudFxProvider(); if (c) out.push(c); }
  if (want.includes("wise") && sandbox !== (process.env.WISE_ENV === "live")) { const w = wiseFxProvider(); if (w) out.push(w); }
  if (want.includes("mock") && sandbox) {
    out.push(new MockFxDesk("mock_fx_a", 28, 0), new MockFxDesk("mock_fx_b", 19, 1.0), new MockFxDesk("mock_fx_c", 35, 0, "US"));
  }
  return out;
}

/** Cost of the FX conversion itself versus the mid-market rate, in basis points (never negative). */
export function spreadBpsVsMid(rate: number, midRate: number): number {
  if (!(midRate > 0)) return 0;
  return Math.max(0, Math.round(((midRate - rate) / midRate) * 10_000 * 100) / 100);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

export interface LiveArgs {
  kind: TransferKindT;
  originCountry: string;
  destCountry: string;
  sourceCurrency: string;
  destCurrency: string;
  sourceAmountMinor: number;
  sourceAmountUsd: number;
  midDestPerSource: number;
  fundingMethod: string;
  /** Test mode (default): sandbox desks and sandbox keys only. Live mode: live providers only. */
  sandbox?: boolean;
  providers?: FxProvider[];
  timeoutMs?: number;
}

export interface LiveLegs { legs: Leg[]; quotes: (FxQuote & { spreadBps: number })[]; errors: { provider: string; error: string }[] }

/**
 * Corridors touching India are excluded on purpose: inbound/outbound INR must go through RBI-authorised partners
 * (PA-CB / MTSS / AD bank), which are separate legs in the catalog.
 */
export async function buildLiveLegs(a: LiveArgs): Promise<LiveLegs> {
  const none: LiveLegs = { legs: [], quotes: [], errors: [] };
  if (a.fundingMethod === "STABLECOIN") return none;
  if (a.originCountry === "IN" || a.destCountry === "IN") return none;
  if (a.sourceCurrency === a.destCurrency) return none;
  const providers = (a.providers ?? fxProviders(a.sandbox ?? true)).filter(p => p.supports(a.sourceCurrency, a.destCurrency));
  if (!providers.length) return none;

  const settled = await Promise.allSettled(providers.map(p =>
    withTimeout(p.quote({ sourceCurrency: a.sourceCurrency, destCurrency: a.destCurrency, sourceAmountMinor: a.sourceAmountMinor, destCountry: a.destCountry }, { destPerSource: a.midDestPerSource, usdPerSource: a.sourceAmountUsd / minorToMajor(a.sourceAmountMinor, a.sourceCurrency) }), a.timeoutMs ?? 6000)));
  const out: LiveLegs = { legs: [], quotes: [], errors: [] };
  settled.forEach((r, i) => {
    if (r.status === "rejected") { out.errors.push({ provider: providers[i].id, error: r.reason instanceof Error ? r.reason.message : String(r.reason) }); return; }
    const q = r.value;
    if (!(q.rate > 0) || q.validUntil.getTime() < Date.now() + 60_000) { out.errors.push({ provider: q.provider, error: "quote unusable (no rate or about to expire)" }); return; }
    // Live money only moves through a partner whose principal-of-record structure is declared (see lib/routing/structure.ts).
    const structure = a.sandbox === false ? providerStructure(q.provider) : undefined;
    if (a.sandbox === false && !structure) { out.errors.push({ provider: q.provider, error: "no partner structure declared (PARTNER_STRUCTURE_JSON)" }); return; }
    const spreadBps = spreadBpsVsMid(q.rate, a.midDestPerSource);
    out.quotes.push({ ...q, spreadBps });
    out.legs.push({
      id: `${q.provider}.direct.${a.sourceCurrency}${a.destCurrency}`, partner: q.provider, kind: "DIRECT", country: q.country, jurisdiction: q.jurisdiction,
      srcCurrency: a.sourceCurrency, destCurrency: a.destCurrency, rails: [q.rail], tokens: [], chains: [],
      spreadBps, feeBps: q.feeBps, fixedFeeUsd: q.fixedFeeUsd, etaSec: q.etaSec, minUsd: q.minUsd, maxUsd: q.maxUsd, kinds: ["BUSINESS", "PERSONAL"],
      ...(structure ? { structure } : {}),
      live: { provider: q.provider, quoteId: q.quoteId, rate: q.rate, midRate: a.midDestPerSource, validUntil: q.validUntil.toISOString() },
    });
  });
  return out;
}

/** What to show the customer / store on the quote: the winner plus every provider that was compared. */
export function summariseFx(chosenLeg: Leg | undefined, live: LiveLegs, amountUsd: number): FxSummary | undefined {
  const l = chosenLeg?.live;
  if (!l || !chosenLeg) return undefined;
  return {
    provider: l.provider, rate: l.rate, mid_rate: l.midRate, spread_bps: spreadBpsVsMid(l.rate, l.midRate), rail: chosenLeg.rails[0], valid_until: l.validUntil,
    compared: live.quotes.map(q => ({ provider: q.provider, rate: q.rate, spread_bps: q.spreadBps, fee_usd: Math.round((q.fixedFeeUsd + (amountUsd * q.feeBps) / 10_000) * 100) / 100, rail: q.rail, eta_seconds: q.etaSec, ...(q.cutOffAt ? { cut_off_at: q.cutOffAt } : {}), chosen: q.provider === l.provider }))
      .sort((x, y) => (x.spread_bps * amountUsd / 10_000 + x.fee_usd) - (y.spread_bps * amountUsd / 10_000 + y.fee_usd)),
    errors: live.errors,
  };
}
