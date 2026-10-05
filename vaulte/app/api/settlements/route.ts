// GET /api/settlements?from=&to=&format=json|csv|xml|pdf — what was sent, converted and paid out, per transfer (session or API key).
import { NextRequest } from "next/server";
import { getAuthUser, verifyApiKey } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { parseFormat, parseRange, renderSettlements, reportHeaders, REPORT_NOTE, settlementsData } from "@/lib/reports/customer";

export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  const orgId = user?.organizationId ?? (await verifyApiKey(req.headers.get("authorization")))?.organizationId;
  if (!orgId) return apiError("UNAUTHORIZED", "Not authenticated", 401);
  const q = req.nextUrl.searchParams;
  const format = parseFormat(q.get("format"));
  if (!format) return apiError("VALIDATION_ERROR", "format must be json, csv, xml or pdf", 400, "format");
  const range = parseRange(q);
  if ("error" in range) return apiError("VALIDATION_ERROR", range.error, 400);
  const d = await settlementsData(orgId, range.from, range.to);
  if (format !== "json") {
    const out = await renderSettlements(d, format);
    return new Response(out.body, { headers: reportHeaders(out.type, `settlements-${range.from.toISOString().slice(0, 10)}_${range.to.toISOString().slice(0, 10)}`, out.ext) });
  }
  return apiSuccess({ ...d, note: REPORT_NOTE });
}
