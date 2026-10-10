import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { requireUser } from "@/lib/auth-guards";
import { revokeAllSessions } from "@/lib/session";

const Patch = z.object({ role: z.enum(["ADMIN", "FINANCE", "DEVELOPER", "READ_ONLY"]) });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireUser(req, { roles: ["OWNER"] });
  if (g.response) return g.response;
  if (params.id === g.user.id) return apiError("FORBIDDEN", "You cannot change your own role", 403);
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Invalid role", 400);
  const m = await db.user.findFirst({ where: { id: params.id, organizationId: g.user.organizationId } });
  if (!m || m.role === "OWNER") return apiError("NOT_FOUND", "Member not found", 404);
  await db.user.update({ where: { id: m.id }, data: { role: parsed.data.role } });
  await db.auditLog.create({ data: { action: "team.role_changed", resourceType: "User", resourceId: m.id, organizationId: m.organizationId, userId: g.user.id, metadata: { role: parsed.data.role } } });
  return apiSuccess({ status: "ok" });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireUser(req, { roles: ["OWNER", "ADMIN"] });
  if (g.response) return g.response;
  if (params.id === g.user.id) return apiError("FORBIDDEN", "You cannot remove yourself", 403);
  const m = await db.user.findFirst({ where: { id: params.id, organizationId: g.user.organizationId } });
  if (!m || m.role === "OWNER") return apiError("NOT_FOUND", "Member not found", 404);
  if (m.role === "ADMIN" && g.user.role !== "OWNER") return apiError("FORBIDDEN", "Only the owner can remove admins", 403);
  await db.user.update({ where: { id: m.id }, data: { status: "SUSPENDED" } });
  await revokeAllSessions(m.id);
  await db.auditLog.create({ data: { action: "team.removed", resourceType: "User", resourceId: m.id, organizationId: m.organizationId, userId: g.user.id } });
  return apiSuccess({ status: "removed" });
}
