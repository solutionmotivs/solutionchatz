// app/api/fx/rates/route.ts
import { NextRequest } from "next/server";
import { verifyApiKey } from "@/lib/auth";
import { getLiveRates } from "@/lib/fx";
import { apiError, apiSuccess } from "@/lib/utils";
import type { Currency } from "@/types";

export async function GET(req: NextRequest) {
  const auth = await verifyApiKey(req.headers.get("authorization"));
  if (!auth) return apiError("UNAUTHORIZED", "Invalid or missing API key", 401);

  const { searchParams } = new URL(req.url);
  const base = (searchParams.get("base") ?? "USD").toUpperCase() as Currency;
  const targetsParam = searchParams.get("targets");
  const DEFAULT_TARGETS: Currency[] = ["EUR","GBP","INR","SGD","AED","JPY","CAD","AUD","CHF","SEK"];
  const targets = targetsParam
    ? targetsParam.split(",").map(t => t.trim().toUpperCase() as Currency)
    : DEFAULT_TARGETS;

  if (targets.length > 50) {
    return apiError("TOO_MANY_TARGETS", "Maximum 50 target currencies per request", 400);
  }

  const rates = await getLiveRates(base, targets);

  return apiSuccess({
    base,
    timestamp: new Date().toISOString(),
    rates,
    spread: 0.0035,
    note: "Rates include 0.35% spread above ECB mid-market rate",
  });
}
