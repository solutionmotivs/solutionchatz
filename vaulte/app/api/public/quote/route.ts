// POST /api/public/quote — public, no account: an ESTIMATE of cost, speed and route for a corridor. Rate limited. Moves and stores nothing.
import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/utils";
import { clientIp, rateLimit } from "@/lib/security/ratelimit";
import { EstimateError, estimate } from "@/lib/public/estimate";

const Schema = z.object({
  from_country: z.string().trim().toUpperCase().length(2),
  to_country: z.string().trim().toUpperCase().length(2),
  from_currency: z.string().trim().toUpperCase().length(3),
  to_currency: z.string().trim().toUpperCase().length(3),
  amount: z.number().positive().max(10_000_000),
  kind: z.enum(["BUSINESS", "PERSONAL"]).default("BUSINESS"),
  funding: z.enum(["FIAT_LOCAL", "STABLECOIN"]).default("FIAT_LOCAL"),
  token: z.enum(["USDC", "USDT", "EURC"]).optional(),
});

export async function POST(req: NextRequest) {
  if (!rateLimit(`pubquote:${clientIp(req)}`, 60, 3600_000)) return apiError("RATE_LIMITED", "Too many estimates. Try again later.", 429);
  let body: unknown; try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Body must be JSON", 400); }
  const p = Schema.safeParse(body);
  if (!p.success) return apiError("VALIDATION_ERROR", p.error.errors[0].message, 400, p.error.errors[0].path.join("."));
  const d = p.data;
  try {
    return apiSuccess(await estimate({ originCountry: d.from_country, destCountry: d.to_country, sourceCurrency: d.from_currency, destCurrency: d.to_currency, amount: d.amount, kind: d.kind, funding: d.funding, token: d.token }));
  } catch (e) {
    if (e instanceof EstimateError) return apiError(e.code, e.message, e.status);
    return apiError("INTERNAL_ERROR", "Could not produce an estimate", 500);
  }
}
