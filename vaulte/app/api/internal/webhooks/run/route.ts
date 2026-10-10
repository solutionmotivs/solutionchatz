// POST /api/internal/webhooks/run — cron hook that delivers due webhooks (protect with CRON_SECRET).
import { NextRequest } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { processDueWebhooks } from "@/lib/webhooks/dispatch";

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req, "CRON_SECRET", "x-cron-secret")) return apiError("UNAUTHORIZED", "Cron secret required", 401);
  return apiSuccess(await processDueWebhooks());
}
