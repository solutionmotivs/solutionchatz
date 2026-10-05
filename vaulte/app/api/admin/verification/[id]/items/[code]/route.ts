// POST — staff verify or fail an identifier by hand (used when no provider can check it automatically).
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";
import { audit, loadCase } from "@/lib/kyc/service";
import { parseJson } from "@/lib/kyc/api";

const Body = z.object({ status: z.enum(["VERIFIED", "FAILED"]), note: z.string().min(3).max(300) });

export async function POST(req: NextRequest, { params }: { params: { id: string; code: string } }) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  const p = await parseJson(req, Body);
  if (p.response) return p.response;
  const c = await loadCase(params.id);
  const it = c?.items.find(i => i.code === params.code.toUpperCase());
  if (!c || !it) return apiError("NOT_FOUND", "Identifier not found", 404);
  if (c.status !== "IN_REVIEW") return apiError("NOT_IN_REVIEW", "Identifiers can only be reviewed while the case is in review", 409);
  await db.verificationItem.update({
    where: { id: it.id },
    data: { status: p.data.status, provider: `staff:${staff.user.id}`, verifiedAt: p.data.status === "VERIFIED" ? new Date() : null, result: { note: p.data.note, manual: true } },
  });
  await audit(c.organizationId, staff.user.id, "verification.item_manual", c.id, { code: it.code, status: p.data.status, note: p.data.note });
  return apiSuccess({ code: it.code, status: p.data.status });
}
