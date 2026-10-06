// POST /api/internal/transfers/watchdog — cron (every 5-15 min): flag transfers past 2x their quoted arrival time.
import { NextRequest } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { runSlowTransferWatchdog } from "@/lib/routing/settlement-metrics";

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req, "CRON_SECRET", "x-cron-secret")) return apiError("UNAUTHORIZED", "Cron secret required", 401);
  return apiSuccess(await runSlowTransferWatchdog());
}
