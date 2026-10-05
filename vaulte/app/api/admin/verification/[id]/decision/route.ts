import { NextRequest } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";
import { decideCase, loadCase } from "@/lib/kyc/service";
import { handleError, parseJson } from "@/lib/kyc/api";

const Body = z.object({ decision: z.enum(["APPROVE", "REJECT", "REQUEST_INFO"]), note: z.string().max(1000).optional() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  const p = await parseJson(req, Body);
  if (p.response) return p.response;
  const c = await loadCase(params.id);
  if (!c) return apiError("NOT_FOUND", "Verification not found", 404);
  try {
    return apiSuccess(await decideCase(c, { id: staff.user.id, name: staff.user.name }, p.data.decision, p.data.note));
  } catch (e) { return handleError(e); }
}
