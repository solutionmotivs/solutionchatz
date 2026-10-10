// POST /api/internal/jobs/run?name=certificate-poll[&force=1] — run one scheduled job now (cron secret). Honours the lease, so it is safe to call from several places.
import { NextRequest } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { JOBS, runJobOnce } from "@/lib/scheduler";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req, "CRON_SECRET", "x-cron-secret")) return apiError("UNAUTHORIZED", "Cron secret required", 401);
  const name = req.nextUrl.searchParams.get("name") ?? "";
  if (!JOBS.some(j => j.name === name)) return apiError("VALIDATION_ERROR", `name must be one of ${JOBS.map(j => j.name).join(", ")}`, 400, "name");
  return apiSuccess(await runJobOnce(name, { force: req.nextUrl.searchParams.get("force") === "1" }));
}
