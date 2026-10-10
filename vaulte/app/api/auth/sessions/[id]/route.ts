import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { requireUser } from "@/lib/auth-guards";
import { revokeSession } from "@/lib/session";

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireUser(req);
  if (g.response) return g.response;
  const s = await db.session.findFirst({ where: { id: params.id, userId: g.user.id } });
  if (!s) return apiError("NOT_FOUND", "Session not found", 404);
  await revokeSession(s.id);
  return apiSuccess({ status: "revoked" });
}
