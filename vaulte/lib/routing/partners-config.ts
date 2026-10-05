// Live partner catalogue. Real corridors, fees and limits come from SIGNED PARTNER AGREEMENTS, so they are configuration,
// not code: set PARTNER_CATALOG_JSON (or PARTNER_CATALOG_FILE) to an array of legs. Test mode uses the mock catalogue only.
// Each leg's `partner` must have an adapter registered in lib/psp/stablecoin/registry.ts (today: "airwallex").
import { readFileSync } from "fs";
import { z } from "zod";
import type { Leg } from "@/lib/stablecoin/types";

const Chain = z.enum(["solana", "base", "ethereum", "tron", "polygon"]);
const LegSchema = z.object({
  id: z.string().min(3),
  partner: z.string().min(2).refine(p => !p.startsWith("mock_"), "mock partners are not allowed in the live catalogue"),
  kind: z.enum(["ACCEPT_TOKEN", "ONRAMP_FIAT", "OFFRAMP", "DIRECT", "INDIA_PAYOUT"]),
  country: z.string().length(2), jurisdiction: z.string().min(2),
  srcCurrency: z.string().length(3).optional(), destCurrency: z.string().length(3).optional(),
  destCurrencies: z.array(z.string().length(3)).optional(), acceptsFiat: z.array(z.string().length(3)).optional(),
  rails: z.array(z.string()).min(1), tokens: z.array(z.enum(["USDC", "USDT"])), chains: z.array(Chain),
  spreadBps: z.number().min(0).max(500), feeBps: z.number().min(0).max(500), fixedFeeUsd: z.number().min(0).max(1000),
  etaSec: z.number().int().positive(), minUsd: z.number().positive(), maxUsd: z.number().positive(),
  kinds: z.array(z.enum(["BUSINESS", "PERSONAL"])).min(1), indiaAuth: z.enum(["PA_CB_E", "PA_CB_I", "MTSS", "LRS_AD"]).optional(),
});

let cached: Leg[] | undefined;

export function parseCatalog(json: string): Leg[] {
  const arr = z.array(LegSchema).parse(JSON.parse(json));
  const ids = new Set<string>();
  for (const l of arr) { if (ids.has(l.id)) throw new Error(`duplicate leg id ${l.id}`); ids.add(l.id); }
  return arr as Leg[];
}

export function realLegs(): Leg[] {
  if (cached) return cached;
  const raw = process.env.PARTNER_CATALOG_JSON ?? (process.env.PARTNER_CATALOG_FILE ? readFileSync(process.env.PARTNER_CATALOG_FILE, "utf8") : "");
  try {
    cached = raw ? parseCatalog(raw) : [];
  } catch (e) {
    // A broken catalogue must never silently fall back to something else: no live routes until it is fixed.
    console.error(JSON.stringify({ level: "error", msg: "PARTNER_CATALOG is invalid; no live routes", error: e instanceof Error ? e.message : String(e) }));
    cached = [];
  }
  return cached;
}

export function resetCatalogCacheForTests() { cached = undefined; }
