// Public estimate engine behind /quote: same route engine, FX comparison, pricing and timing as a real quote, but with no account,
// no entities and no guardrail checks. It is an ESTIMATE; a real quote needs a verified account. It moves nothing and stores nothing.
import { closedCountryList, currencyStatus, majorToMinor, minorToMajor, expOf } from "@/lib/currency";
import { getRateTable } from "@/lib/stablecoin/rates";
import { buildBreakdown, fromUsd, markupBpsFor, toUsd, validateMargin } from "@/lib/pricing";
import { feeSplit } from "@/lib/pricing/split";
import { buildLiveLegs, spreadBpsVsMid, summariseFx, type LiveLegs } from "@/lib/fx/aggregator";
import { MOCK_LEGS } from "@/lib/routing/catalog";
import { realLegs } from "@/lib/routing/partners-config";
import { closedCountries } from "@/lib/routing/corridors";
import { applyAgentGate } from "@/lib/routing/structure";
import { findRoutes, rankRoutes } from "@/lib/routing/engine";
import { buildTiming } from "@/lib/routing/timing";
import { corridorTiming } from "@/lib/routing/settlement-metrics";
import { TOKEN_PEG, type Preference, type Route, type Token, type TransferKindT } from "@/lib/stablecoin/types";

export class EstimateError extends Error { constructor(public code: string, message: string, public status = 422) { super(message); } }

export interface EstimateInput {
  originCountry: string; destCountry: string; sourceCurrency: string; destCurrency: string;
  amount: number; kind: TransferKindT; funding: "FIAT_LOCAL" | "STABLECOIN"; token?: Token;
}

const LABEL: Record<string, string> = { same_day: "Lands today", cheapest: "Lowest cost", fastest: "Fastest" };

function describe(r: Route) {
  return { partners: r.partners, token: r.token, chain: r.chain, legs: r.legs.map(l => ({ partner: l.partner, kind: l.kind, rails: l.rails, country: l.country })) };
}

export async function estimate(i: EstimateInput) {
  const o = i.originCountry.toUpperCase(), d = i.destCountry.toUpperCase();
  const shut = [i.sourceCurrency, i.destCurrency].filter(c => currencyStatus(c) === "CLOSED");
  if (shut.length) throw new EstimateError("CURRENCY_CLOSED", `${shut.join(", ")} payments are not available (closed for legal reasons).`);
  const shutC = [o, d].filter(c => closedCountryList().has(c));
  if (shutC.length) throw new EstimateError("COUNTRY_CLOSED", `Payments to or from ${shutC.join(", ")} are not available.`);
  if (i.funding === "STABLECOIN") {
    const token = i.token ?? "USDC";
    if (TOKEN_PEG[token] !== i.sourceCurrency) throw new EstimateError("INVALID_FUNDING", `${token} is priced in ${TOKEN_PEG[token]}; use ${TOKEN_PEG[token]} as the sending currency.`, 400);
  }
  const rates = await getRateTable([i.sourceCurrency, i.destCurrency, "INR"]).catch(() => { throw new EstimateError("UNSUPPORTED_CURRENCY", "Rate unavailable for this currency pair."); });
  const sourceMinor = majorToMinor(i.amount, i.sourceCurrency);
  if (!(sourceMinor > 0)) throw new EstimateError("VALIDATION_ERROR", "Enter an amount.", 400);
  const usd = toUsd(sourceMinor, i.sourceCurrency, rates);

  // Live estimates only where a contracted catalogue exists and counsel has opened both countries; otherwise a test-mode estimate.
  const live = realLegs().length > 0 && closedCountries(o, d, false).length === 0;
  const sandbox = !live;
  const baseLegs = sandbox ? MOCK_LEGS : realLegs();
  const fx = await buildLiveLegs({ sandbox, kind: i.kind, originCountry: o, destCountry: d, sourceCurrency: i.sourceCurrency, destCurrency: i.destCurrency, sourceAmountMinor: sourceMinor, sourceAmountUsd: usd, midDestPerSource: rates[i.destCurrency] / rates[i.sourceCurrency], fundingMethod: i.funding })
    .catch(() => ({ legs: [], quotes: [], errors: [{ provider: "fx", error: "aggregator failed" }] }) as LiveLegs);
  let routes = findRoutes({ kind: i.kind, originCountry: o, destCountry: d, sourceCurrency: i.sourceCurrency, destCurrency: i.destCurrency, amountUsd: usd, fundingMethod: i.funding, token: i.funding === "STABLECOIN" ? i.token : undefined }, { legs: [...baseLegs, ...fx.legs] });
  if (!sandbox) routes = applyAgentGate(routes, o).allowed;
  if (!routes.length) throw new EstimateError("NO_ROUTE", "No route is available for this corridor and amount yet.");

  // Test-mode transfers settle instantly in simulation, so they say nothing about real speed: only live measurements are shown as measured.
  const measured = sandbox ? null : await corridorTiming(o, d, false).catch(() => null);
  const markupBps = markupBpsFor(i.kind, usd, undefined, { origin: o, dest: d });
  const options: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const prefer of ["same_day", "cheapest", "fastest"] as Preference[]) {
    const best = rankRoutes(routes, usd, prefer, { destCountry: d }).find(r => {
      const b = buildBreakdown({ route: r, kind: i.kind, sourceCurrency: i.sourceCurrency, destCurrency: i.destCurrency, sourceAmountMinor: sourceMinor, rates, markupBps });
      return validateMargin(b).ok;
    });
    if (!best || seen.has(best.id)) continue;
    seen.add(best.id);
    const b = buildBreakdown({ route: best, kind: i.kind, sourceCurrency: i.sourceCurrency, destCurrency: i.destCurrency, sourceAmountMinor: sourceMinor, rates, markupBps });
    const destMinor = Math.floor(fromUsd(b.destAmountUsd, i.destCurrency, rates) * 10 ** expOf(i.destCurrency));
    const timing = buildTiming(best, d, measured);
    const midDest = minorToMajor(sourceMinor, i.sourceCurrency) * (rates[i.destCurrency] / rates[i.sourceCurrency]);
    options.push({
      label: LABEL[prefer], prefer, route: describe(best),
      you_send: { currency: i.sourceCurrency, amount_minor: sourceMinor },
      they_receive: { currency: i.destCurrency, amount_minor: destMinor },
      effective_rate: Number((minorToMajor(destMinor, i.destCurrency) / minorToMajor(sourceMinor, i.sourceCurrency)).toFixed(6)),
      mid_market_rate: Number((rates[i.destCurrency] / rates[i.sourceCurrency]).toFixed(6)),
      cost_vs_mid_bps: Math.round(spreadBpsVsMid(minorToMajor(destMinor, i.destCurrency), midDest) * 100) / 100,
      fees: feeSplit(b),
      bank_wire_estimate_usd: b.bankWireEstimateCostUsd, saves_vs_bank_usd: b.savingsVsBankUsd,
      timing: { basis: timing.basis, same_day: timing.same_day, within_24h: timing.within_24h, waits_for_banking_hours: timing.waits_for_banking_hours, effective_seconds: timing.effective_seconds, measured: timing.measured, note: timing.note },
      fx_compared: summariseFx(best.legs.find(l => l.live), fx, usd)?.compared ?? null,
    });
  }
  const cert = d === "IN" && i.kind === "BUSINESS"
    ? "For business payments into India the licensed partner issues the eFIRA/FIRC where applicable; Vaulte attaches it to your records and tracks the eBRC. Vaulte does not issue certificates."
    : null;
  return {
    mode: sandbox ? "test" : "live",
    estimate: true,
    options,
    recommended: options[0] ?? null,
    certificate: cert,
    disclaimer: sandbox
      ? "Test-mode estimate using simulated partners and indicative rates. Real prices come from signed partner agreements and are shown on a real quote."
      : "Estimate from live partner quotes. The final quote needs a verified account and is firm until it expires. Times are targets or measured, not guarantees.",
  };
}
