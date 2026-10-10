import { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/utils";
import { guard, publicLimited } from "@/lib/escrow/api";
import { fundingFor } from "@/lib/escrow/service";

export async function GET(req: NextRequest, { params }: { params: { token: string; mid: string } }) {
  if (publicLimited(req, "fund", 20)) return apiError("RATE_LIMITED", "Slow down", 429);
  return guard(async () => apiSuccess(await fundingFor(params.token, params.mid)));
}
