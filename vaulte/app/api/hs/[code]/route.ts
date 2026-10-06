// GET /api/hs/:code — validate one code (4, 6, 8 or 10 digits), with trade-risk flags and whether it is a goods purpose hint.
import { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/utils";
import { clientIp, rateLimit } from "@/lib/security/ratelimit";
import { hsChapterTitle, validateHs } from "@/lib/trade/hs";
import { tradeFlags } from "@/lib/trade/risk";

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  if (!rateLimit(`hs:${clientIp(req)}`, 120, 60_000)) return apiError("RATE_LIMITED", "Too many requests", 429);
  const v = validateHs(params.code);
  if (!v.ok) return apiError("INVALID_HS", v.reason, 404);
  return apiSuccess({ code: v.code, level_digits: v.level, description: v.description, chapter: v.chapter, chapter_title: hsChapterTitle(v.chapter), national_extension_unchecked: v.national_extension, flags: tradeFlags([v.code]), purpose_hint: "Goods: use an RBI P01xx purpose code and keep the HS code on the invoice and shipping bill." });
}
