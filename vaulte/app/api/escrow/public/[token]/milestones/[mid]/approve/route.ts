import { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/utils";
import { guard, publicLimited } from "@/lib/escrow/api";
import { approveMilestone } from "@/lib/escrow/service";

export async function POST(req: NextRequest, { params }: { params: { token: string; mid: string } }) {
  if (publicLimited(req, "act", 20)) return apiError("RATE_LIMITED", "Slow down", 429);
  return guard(async () => { await approveMilestone(params.mid, "BUYER", params.token); return apiSuccess({ status: "APPROVED" }); });
}
