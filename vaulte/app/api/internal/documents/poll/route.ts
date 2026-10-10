// POST /api/internal/documents/poll — cron (every 1-6 hours): ask payout partners for eFIRA/eBRC and other certificates still missing.
import { NextRequest } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { runCertificatePoll } from "@/lib/documents/poll";

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req, "CRON_SECRET", "x-cron-secret")) return apiError("UNAUTHORIZED", "Cron secret required", 401);
  return apiSuccess(await runCertificatePoll());
}
