// POST /api/admin/transfers/:id/review — staff decision on a transfer that is on hold.
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";
import { handleServiceError, readJson } from "@/lib/api-helpers";
import { reviewTransfer, serializeTransfer } from "@/lib/stablecoin/service";

const Schema = z.object({ decision: z.enum(["RELEASE", "REJECT"]), note: z.string().max(500).optional() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  const body = await readJson(req);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", "decision must be RELEASE or REJECT", 400);
  try {
    return apiSuccess(serializeTransfer(await reviewTransfer(params.id, parsed.data.decision, parsed.data.note)));
  } catch (e) {
    return handleServiceError(e);
  }
}
