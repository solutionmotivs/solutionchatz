// POST /api/internal/erp/sync — cron (every 15 minutes): push new completed transfers for every connected accounting system.
import { NextRequest } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { syncAllConnections } from "@/lib/erp/sync";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req, "CRON_SECRET", "x-cron-secret")) return apiError("UNAUTHORIZED", "Cron secret required", 401);
  return apiSuccess(await syncAllConnections());
}
