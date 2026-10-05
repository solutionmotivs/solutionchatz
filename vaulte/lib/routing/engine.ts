// Route engine: picks the cheapest / fastest combination of partner legs for a transfer.
// Vaulte owns no rail; a "route" is an ordered set of partner legs with a firm price.
import type { Chain, Leg, Preference, Route, Token, TransferKindT, FundingMethodT } from "@/lib/stablecoin/types";
import { CHAIN_ETA_SEC, CHAIN_FEE_USD, JURISDICTION_TOKEN_RULES, MOCK_LEGS } from "./catalog";

export interface RouteRequest {
  kind: TransferKindT;
  originCountry: string;
  destCountry: string;
  sourceCurrency: string;
  destCurrency: string;
  amountUsd: number;
  fundingMethod: FundingMethodT;
  /** Restrict to one token (optional). */
  token?: Token;
}

export interface RouteOptions {
  legs?: Leg[];
  /** Partners currently failing; their legs are skipped (failover). */
  unavailablePartners?: string[];
}

const HUB_CURRENCIES = ["USD", "AED", "EUR", "GBP", "SGD"];

export function tokenAllowedOnLeg(leg: Leg, token: Token): boolean {
  const rule = JURISDICTION_TOKEN_RULES[leg.jurisdiction];
  if (rule && !rule.allowed.includes(token)) return false;
  return leg.tokens.length === 0 || leg.tokens.includes(token);
}

function chainsFor(a: Leg, b: Leg, token: Token): Chain[] {
  return a.chains.filter(c => b.chains.includes(c)).filter(() => tokenAllowedOnLeg(a, token) && tokenAllowedOnLeg(b, token));
}

function buildRoute(legs: Leg[], token: Token | null, chain: Chain | null): Route {
  const usesStablecoin = token !== null;
  const chainFee = chain ? CHAIN_FEE_USD[chain] ?? 0 : 0;
  return {
    id: legs.map(l => l.id).join(">") + (token ? `|${token}@${chain}` : ""),
    legs,
    token,
    chain,
    partners: Array.from(new Set(legs.map(l => l.partner))),
    spreadBps: legs.reduce((s, l) => s + l.spreadBps, 0),
    feeBps: legs.reduce((s, l) => s + l.feeBps, 0),
    fixedFeeUsd: legs.reduce((s, l) => s + l.fixedFeeUsd, 0) + chainFee,
    etaSec: legs.reduce((s, l) => s + l.etaSec, 0) + (chain ? CHAIN_ETA_SEC[chain] ?? 60 : 0),
    minUsd: Math.max(...legs.map(l => l.minUsd)),
    maxUsd: Math.min(...legs.map(l => l.maxUsd)),
    usesStablecoin,
  };
}

export function routeCostUsd(route: Route, amountUsd: number): number {
  return (amountUsd * (route.spreadBps + route.feeBps)) / 10_000 + route.fixedFeeUsd;
}

export function scoreRoute(route: Route, amountUsd: number, prefer: Preference): number {
  const costBps = (routeCostUsd(route, amountUsd) / amountUsd) * 10_000;
  const hours = route.etaSec / 3600;
  if (prefer === "cheapest") return costBps * 1_000_000 + route.etaSec;
  if (prefer === "fastest") return route.etaSec * 1_000_000 + costBps;
  return costBps + hours * 5; // balanced: 5 bps per hour of delay
}

export function findRoutes(req: RouteRequest, opts: RouteOptions = {}): Route[] {
  const all = (opts.legs ?? MOCK_LEGS).filter(l => !(opts.unavailablePartners ?? []).includes(l.partner));
  const usable = (l: Leg) => l.kinds.includes(req.kind);
  const legs = all.filter(usable);
  const routes: Route[] = [];
  const src = req.sourceCurrency;
  const dst = req.destCurrency;

  // India-origin: fiat only. The Indian sender never buys or sends crypto; recipient gets fiat abroad.
  if (req.originCountry === "IN") {
    for (const l of legs) {
      if (l.kind === "DIRECT" && l.srcCurrency === src && (l.destCurrencies ?? []).includes(dst)) {
        routes.push(buildRoute([l], null, null));
      }
    }
    return finalise(routes, req);
  }

  // 1) Direct fiat -> fiat (local rails, or a live-priced FX provider). Never with stablecoin funding.
  for (const l of legs) {
    if (req.fundingMethod === "STABLECOIN") break;
    if (l.kind === "DIRECT" && l.srcCurrency === src && l.destCurrency === dst && l.jurisdiction !== "IN") {
      routes.push(buildRoute([l], null, null));
    }
  }

  // 2) Stablecoin routes: funding leg -> (offshore exit) [-> India payout]
  const fundingLegs = legs.filter(l =>
    req.fundingMethod === "STABLECOIN" ? l.kind === "ACCEPT_TOKEN" : l.kind === "ONRAMP_FIAT" && l.srcCurrency === src,
  );
  const offramps = legs.filter(l => l.kind === "OFFRAMP");
  const indiaPayouts = legs.filter(l => l.kind === "INDIA_PAYOUT");
  const toIndia = req.destCountry === "IN";

  for (const f of fundingLegs) {
    // Direct stablecoin exit in destination currency (not India)
    if (!toIndia) {
      for (const x of offramps.filter(o => o.destCurrency === dst)) {
        for (const token of ["USDC", "USDT"] as Token[]) {
          if (req.token && req.token !== token) continue;
          for (const chain of chainsFor(f, x, token)) routes.push(buildRoute(dedupe([f, x]), token, chain));
        }
      }
      continue;
    }
    // India: stablecoin leg stays offshore, then fiat into an authorised India partner
    for (const x of offramps.filter(o => HUB_CURRENCIES.includes(o.destCurrency ?? ""))) {
      for (const p of indiaPayouts.filter(ip => (ip.acceptsFiat ?? []).includes(x.destCurrency ?? ""))) {
        for (const token of ["USDC", "USDT"] as Token[]) {
          if (req.token && req.token !== token) continue;
          for (const chain of chainsFor(f, x, token)) routes.push(buildRoute(dedupe([f, x, p]), token, chain));
        }
      }
    }
  }

  // 3) Fiat-only into India (no stablecoin): partner receives hard currency and pays INR
  //    kept as the always-available fallback when stablecoin legs are blocked or down.
  if (toIndia && req.fundingMethod !== "STABLECOIN") {
    for (const p of indiaPayouts.filter(ip => (ip.acceptsFiat ?? []).includes(src))) {
      routes.push(buildRoute([p], null, null));
    }
  }
  return finalise(routes, req);
}

function dedupe(legs: Leg[]): Leg[] {
  const seen = new Set<string>();
  return legs.filter(l => (seen.has(l.id) ? false : (seen.add(l.id), true)));
}

function finalise(routes: Route[], req: RouteRequest): Route[] {
  const unique = new Map<string, Route>();
  for (const r of routes) {
    if (req.amountUsd < r.minUsd || req.amountUsd > r.maxUsd) continue;
    // An explicit token request means "use this stablecoin": drop fiat-only and other-token routes.
    if (req.token && r.token !== req.token) continue;
    // India legs must match the transfer kind's authorisation
    if (r.legs.some(l => l.indiaAuth) && !r.legs.every(l => l.kinds.includes(req.kind))) continue;
    unique.set(r.id, r);
  }
  // Keep only the cheapest and the fastest chain per leg combination: chains differ only in fee and arrival time.
  const groups = new Map<string, Route[]>();
  for (const r of unique.values()) {
    const key = r.legs.map(l => l.id).join(">") + "|" + (r.token ?? "");
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const kept: Route[] = [];
  for (const g of groups.values()) {
    const cheapest = g.reduce((a, b) => (a.fixedFeeUsd <= b.fixedFeeUsd ? a : b));
    const fastest = g.reduce((a, b) => (a.etaSec <= b.etaSec ? a : b));
    kept.push(cheapest);
    if (fastest.id !== cheapest.id) kept.push(fastest);
  }
  return kept;
}

export function rankRoutes(routes: Route[], amountUsd: number, prefer: Preference): Route[] {
  return [...routes].sort((a, b) => scoreRoute(a, amountUsd, prefer) - scoreRoute(b, amountUsd, prefer));
}

/** Failover: next-best route that avoids the partners that just failed. */
export function nextRoute(ranked: Route[], failedPartners: string[]): Route | null {
  return ranked.find(r => !r.partners.some(p => failedPartners.includes(p))) ?? null;
}

/**
 * Fallback routes kept on a quote. Priority 1: for the SAME funding partner as the chosen route, the best route per other
 * payout partner (so a payout failure can fail over while the funds stay where they are). Priority 2: other funding
 * partners, for reference/re-quoting. One route per (funding, payout, token) combination.
 */
export function pickAlternates(ranked: Route[], chosen: Route, max = 6): Route[] {
  const lastPartner = (r: Route) => r.legs[r.legs.length - 1].partner;
  const funding = chosen.legs[0].partner;
  const seen = new Set<string>();
  const out: Route[] = [];
  const take = (r: Route) => {
    const key = `${r.legs[0].partner}|${lastPartner(r)}|${r.token ?? "fiat"}`;
    if (r.id === chosen.id || seen.has(key)) return;
    seen.add(key);
    out.push(r);
  };
  for (const r of ranked) if (r.legs[0].partner === funding && lastPartner(r) !== lastPartner(chosen)) take(r);
  for (const r of ranked) {
    if (out.length >= max) break;
    take(r);
  }
  return out.slice(0, Math.max(max, 1));
}
