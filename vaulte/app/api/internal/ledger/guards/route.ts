// POST /api/internal/ledger/guards — install the ledger's database triggers (run once after deploy: node scripts/db-guards.mjs).
import { NextRequest } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { guardsInstalled, installGuards } from "@/lib/ledger/guards";

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req, "CRON_SECRET", "x-cron-secret")) return apiError("UNAUTHORIZED", "Cron secret required", 401);
  await installGuards();
  return apiSuccess({ installed: await guardsInstalled() });
}
