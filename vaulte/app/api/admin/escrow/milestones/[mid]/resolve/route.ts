// POST /api/admin/escrow/milestones/:mid/resolve {resolution: RELEASE|REFUND, note}
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/auth-guards";
import { apiSuccess } from "@/lib/utils";
import { body, guard } from "@/lib/escrow/api";
import { resolveDispute } from "@/lib/escrow/service";

export async function POST(req: NextRequest, { params }: { params: { mid: string } }) {
  const g = await requireStaff(req);
  if (g.response) return g.response;
  const p = await body(req, z.object({ resolution: z.enum(["RELEASE", "REFUND"]), note: z.string().min(1).max(1500) }));
  if (p.response) return p.response;
  return guard(async () => { await resolveDispute(params.mid, g.user.id, p.data.resolution, p.data.note); return apiSuccess({ status: "RESOLVED", resolution: p.data.resolution }); });
}
