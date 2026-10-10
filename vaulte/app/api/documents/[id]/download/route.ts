import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError } from "@/lib/utils";
import { loadDecrypted } from "@/lib/storage";
import { orgContext } from "@/lib/documents/api";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const c = await orgContext(req);
  if (c.response) return c.response;
  const d = await db.document.findFirst({ where: { id: params.id, organizationId: c.orgId } });
  if (!d) return apiError("NOT_FOUND", "Document not found", 404);
  if (!d.storageKey) return apiError("NO_FILE", "This document is a reference number only", 404);
  const data = await loadDecrypted(d.storageKey);
  await db.auditLog.create({ data: { organizationId: c.orgId, userId: c.userId ?? null, action: "document.downloaded", resourceType: "Document", resourceId: d.id } });
  return new Response(new Uint8Array(data), { headers: { "Content-Type": d.mime ?? "application/octet-stream", "Content-Disposition": `attachment; filename="${d.filename}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
}
