// POST /api/internal/sanctions/sync — cron: refresh OFAC / UN / UK lists. ?force=1 re-imports even if unchanged.
import { NextRequest } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { syncAll } from "@/lib/sanctions/sync";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req, "CRON_SECRET", "x-cron-secret")) return apiError("UNAUTHORIZED", "Cron secret required", 401);
  const results = await syncAll({ force: req.nextUrl.searchParams.get("force") === "1" });
  return apiSuccess({ results });
}
