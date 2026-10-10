// POST /api/internal/escrow/run — cron (hourly): deemed approvals after the agreed window.
import { NextRequest } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { runDeemedApprovals } from "@/lib/escrow/service";

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req, "CRON_SECRET", "x-cron-secret")) return apiError("UNAUTHORIZED", "Cron secret required", 401);
  return apiSuccess({ deemed_approved: await runDeemedApprovals() });
}
