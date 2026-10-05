import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";
import { parseJson } from "@/lib/kyc/api";

/** Close an exception with an explanation (e.g. "partner fee, booked via manual journal #12"). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  const p = await parseJson(req, z.object({ note: z.string().min(10).max(500) }));
  if (p.response) return p.response;
  const l = await db.reconLine.findUnique({ where: { id: params.id } });
  if (!l || l.status === "MATCHED" || l.status === "RESOLVED") return apiError("NOT_FOUND", "No open exception with that id", 404);
  await db.reconLine.update({ where: { id: l.id }, data: { status: "RESOLVED", note: p.data.note, resolvedById: staff.user.id, resolvedAt: new Date() } });
  return apiSuccess({ id: l.id, status: "RESOLVED" });
}
