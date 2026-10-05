import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/utils";
import { body, guard, publicLimited } from "@/lib/escrow/api";
import { declineDeal } from "@/lib/escrow/service";

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  if (publicLimited(req, "act", 20)) return apiError("RATE_LIMITED", "Slow down", 429);
  const p = await body(req, z.object({ note: z.string().max(500).optional() }));
  if (p.response) return p.response;
  return guard(async () => { await declineDeal(params.token, p.data.note); return apiSuccess({ status: "CANCELLED" }); });
}
