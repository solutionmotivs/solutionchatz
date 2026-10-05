import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/utils";
import { body, guard, publicLimited } from "@/lib/escrow/api";
import { disputeMilestone } from "@/lib/escrow/service";

export async function POST(req: NextRequest, { params }: { params: { token: string; mid: string } }) {
  if (publicLimited(req, "act", 20)) return apiError("RATE_LIMITED", "Slow down", 429);
  const p = await body(req, z.object({ reason: z.string().min(1).max(1500) }));
  if (p.response) return p.response;
  return guard(async () => { await disputeMilestone(params.mid, "BUYER", p.data.reason, { token: params.token }); return apiSuccess({ status: "DISPUTED" }); });
}
