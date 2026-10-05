import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiError } from "@/lib/utils";
import { loadDecrypted } from "@/lib/storage";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  const d = await db.document.findUnique({ where: { id: params.id } });
  if (!d?.storageKey) return apiError("NOT_FOUND", "No file for this document", 404);
  await db.auditLog.create({ data: { organizationId: d.organizationId, userId: staff.user.id, action: "document.viewed_by_staff", resourceType: "Document", resourceId: d.id } });
  return new Response(new Uint8Array(await loadDecrypted(d.storageKey)), { headers: { "Content-Type": d.mime ?? "application/octet-stream", "Content-Disposition": `inline; filename="${d.filename}"`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox", "Cache-Control": "private, no-store" } });
}
