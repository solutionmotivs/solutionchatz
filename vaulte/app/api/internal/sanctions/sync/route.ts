// POST /api/internal/sanctions/sync — cron: refresh OFAC / UN / UK lists. ?force=1 re-imports even if unchanged.
import { NextRequest } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { SOURCES, syncAll, syncList, type ListCode } from "@/lib/sanctions/sync";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req, "CRON_SECRET", "x-cron-secret")) return apiError("UNAUTHORIZED", "Cron secret required", 401);
  const force = req.nextUrl.searchParams.get("force") === "1";
  // ?list=OFAC_SDN|UN|UK syncs one list per request: keeps peak memory low on small instances.
  const one = req.nextUrl.searchParams.get("list");
  if (one) {
    if (!(one in SOURCES)) return apiError("VALIDATION_ERROR", `list must be one of ${Object.keys(SOURCES).join(", ")}`, 400, "list");
    return apiSuccess({ results: [await syncList(one as ListCode, { force })] });
  }
  const results = await syncAll({ force });
  return apiSuccess({ results });
}
