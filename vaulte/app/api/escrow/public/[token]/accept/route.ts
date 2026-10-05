import { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/utils";
import { guard, publicLimited } from "@/lib/escrow/api";
import { acceptDeal } from "@/lib/escrow/service";

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  if (publicLimited(req, "act", 20)) return apiError("RATE_LIMITED", "Slow down", 429);
  return guard(async () => apiSuccess({ status: (await acceptDeal(params.token)).status }));
}
