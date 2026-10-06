// GET /api/admin/settlement-stats — staff: measured settlement time per corridor (funds confirmed -> completed), last 30 days.
import { NextRequest } from "next/server";
import { requireStaff } from "@/lib/auth-guards";
import { apiSuccess } from "@/lib/utils";
import { settlementReport } from "@/lib/routing/settlement-metrics";

export async function GET(req: NextRequest) {
  const g = await requireStaff(req);
  if (g.response) return g.response;
  return apiSuccess({ window_days: 30, min_samples_to_publish: 5, corridors: await settlementReport() });
}
