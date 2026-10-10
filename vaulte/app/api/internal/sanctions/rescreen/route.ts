// POST /api/internal/sanctions/rescreen — cron: re-screen customers and related people against the current lists.
import { NextRequest } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { rescreenAll } from "@/lib/sanctions/rescreen";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req, "CRON_SECRET", "x-cron-secret")) return apiError("UNAUTHORIZED", "Cron secret required", 401);
  return apiSuccess(await rescreenAll());
}
