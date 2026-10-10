import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { requireUser } from "@/lib/auth-guards";

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireUser(req, { roles: ["OWNER", "ADMIN"] });
  if (g.response) return g.response;
  const r = await db.invite.deleteMany({ where: { id: params.id, organizationId: g.user.organizationId, acceptedAt: null } });
  return r.count ? apiSuccess({ status: "deleted" }) : apiError("NOT_FOUND", "Invitation not found", 404);
}
