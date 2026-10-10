// GET /api/hs?q=cotton trousers   or   ?q=6203  — search HS 2022 (open data, see data/README-hs.md). Public, rate limited.
import { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/utils";
import { clientIp, rateLimit } from "@/lib/security/ratelimit";
import { searchHs } from "@/lib/trade/hs";
import { tradeFlags } from "@/lib/trade/risk";

export async function GET(req: NextRequest) {
  if (!rateLimit(`hs:${clientIp(req)}`, 120, 60_000)) return apiError("RATE_LIMITED", "Too many searches", 429);
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (q.trim().length < 2) return apiError("VALIDATION_ERROR", "Type at least 2 characters", 400, "q");
  const res = searchHs(q, 20).map(e => ({ code: e.code, description: e.description, level: e.level, section: e.section, flags: tradeFlags([e.code]).map(f => f.code) }));
  return apiSuccess({ data: res, source: "HS 2022 (WCO nomenclature via UN Comtrade open data). National 8-digit ITC-HS codes are not included." });
}
