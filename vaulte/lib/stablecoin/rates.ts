import { getLiveRates } from "@/lib/fx";
import type { Currency } from "@/types";
import type { RateTable } from "./types";

export class RateUnavailableError extends Error {}

/** Units of each currency per 1 USD, from the cached live feed (with a documented fallback table). */
export async function getRateTable(currencies: string[]): Promise<RateTable> {
  const wanted = Array.from(new Set(currencies.map(c => c.toUpperCase()))).filter(c => c !== "USD");
  const live = wanted.length ? await getLiveRates("USD", wanted as Currency[]) : {};
  const table: RateTable = { USD: 1 };
  for (const c of wanted) {
    const r = live[c];
    if (!r) throw new RateUnavailableError(`No FX rate available for ${c}`);
    table[c] = r;
  }
  return table;
}
