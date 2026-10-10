// lib/fx.ts
// FX rate engine — fetches from Open Exchange Rates, caches in DB

import { db } from "@/lib/db";
import type { Currency } from "@/types";

const SPREAD_BPS = 35; // 0.35% spread above mid-market

export async function getLiveRates(
  base: Currency = "USD",
  targets: Currency[]
): Promise<Record<string, number>> {
  // Try DB cache first (max 5 minutes old)
  const cached: Record<string, number> = {};
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  for (const target of targets) {
    const row = await db.fxRate.findUnique({
      where: { base_target: { base, target } },
    });
    if (row && row.updatedAt > fiveMinAgo) {
      cached[target] = row.midRate;
    }
  }

  const missing = targets.filter(t => !cached[t]);

  if (missing.length > 0 && process.env.OPENEXCHANGERATES_APP_ID) {
    try {
      const url = `https://openexchangerates.org/api/latest.json?app_id=${process.env.OPENEXCHANGERATES_APP_ID}&base=${base}&symbols=${missing.join(",")}`;
      const res = await fetch(url, { next: { revalidate: 300 } });

      if (res.ok) {
        const data = await res.json();
        const rates: Record<string, number> = data.rates ?? {};

        // Upsert to DB cache
        for (const [target, rate] of Object.entries(rates)) {
          const spread = rate * (SPREAD_BPS / 10000);
          await db.fxRate.upsert({
            where: { base_target: { base, target } },
            create: {
              base,
              target,
              midRate: rate,
              buyRate: rate - spread,
              sellRate: rate + spread,
              source: "openexchangerates",
            },
            update: {
              midRate: rate,
              buyRate: rate - spread,
              sellRate: rate + spread,
            },
          });
          cached[target] = rate;
        }
      }
    } catch {
      // Use stale cache or fallback
    }
  }

  // Free, keyless reference rates (European Central Bank via Frankfurter) when no Open Exchange Rates key is set or it failed.
  // AED and SAR are fixed to the dollar by their central banks. Indicative mid-market only: partners give the firm prices.
  const stillMissing = targets.filter(t => !cached[t]);
  if (stillMissing.length > 0 && process.env.FX_FREE_SOURCE !== "off") {
    const fetched = await fetchFrankfurter(base, stillMissing);
    for (const [target, rate] of Object.entries(fetched)) {
      cached[target] = rate;
      const spread = rate * (SPREAD_BPS / 10000);
      await db.fxRate.upsert({
        where: { base_target: { base, target } },
        create: { base, target, midRate: rate, buyRate: rate - spread, sellRate: rate + spread, source: "frankfurter" },
        update: { midRate: rate, buyRate: rate - spread, sellRate: rate + spread, source: "frankfurter" },
      }).catch(() => undefined);
    }
  }

  // Fallback hardcoded rates for dev/offline
  const FALLBACK: Record<string, number> = {
    EUR: 0.9211, GBP: 0.7853, INR: 83.42, SGD: 1.3480,
    AED: 3.6725, CHF: 0.8841, JPY: 149.5, CAD: 1.3612,
    AUD: 1.5231, SEK: 10.42, NOK: 10.58, MYR: 4.72,
    THB: 35.2, IDR: 15680, PHP: 55.8, SAR: 3.75,
    CNH: 7.13, CNY: 7.12, HKD: 7.8, NZD: 1.66, DKK: 6.87, PLN: 3.95, NPR: 133.5,
  };

  // Never quote real money from a hard-coded table: in production a missing live rate means "no quote".
  for (const target of missing) {
    if (process.env.NODE_ENV === "production" && process.env.DEMO_MODE !== "true") break;
    if (!cached[target] && FALLBACK[target]) {
      cached[target] = FALLBACK[target];
    }
  }

  return cached;
}

const PEGS_PER_USD: Record<string, number> = { AED: 3.6725, SAR: 3.75 };

/** ECB reference rates through Frankfurter (no key). Returns only the currencies it could price. */
export async function fetchFrankfurter(base: string, targets: string[], f: typeof fetch = fetch): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (base !== "USD") return out;
  for (const t of targets) if (PEGS_PER_USD[t]) out[t] = PEGS_PER_USD[t];
  const need = targets.filter(t => !out[t] && t !== "USD");
  if (!need.length) return out;
  try {
    const res = await f(`${process.env.FRANKFURTER_URL ?? "https://api.frankfurter.dev/v1"}/latest?base=USD&symbols=${need.join(",")}`, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const j = (await res.json()) as { rates?: Record<string, number> };
      for (const [k, v] of Object.entries(j.rates ?? {})) if (typeof v === "number" && v > 0) out[k] = v;
    }
  } catch { /* stale cache or no quote */ }
  return out;
}

export async function convertToUsd(
  amount: bigint,
  currency: string
): Promise<number> {
  if (currency === "USD") return Number(amount) / 100;

  const rates = await getLiveRates("USD", [currency as Currency]);
  const rate = rates[currency];
  if (!rate) return Number(amount) / 100; // fallback

  return (Number(amount) / 100) / rate;
}

export function applySpread(midRate: number, direction: "buy" | "sell"): number {
  const spread = midRate * (SPREAD_BPS / 10000);
  return direction === "buy" ? midRate - spread : midRate + spread;
}
