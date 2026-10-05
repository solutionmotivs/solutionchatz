// POST /api/admin/documents/:id {decision: VERIFY|REJECT, note} — staff confirm the document is genuine and belongs to the transfer.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";
import { parseJson } from "@/lib/kyc/api";
import { emitWebhookEvent } from "@/lib/webhooks/dispatch";

const Body = z.object({ decision: z.enum(["VERIFY", "REJECT"]), note: z.string().max(500).optional() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  const p = await parseJson(req, Body);
  if (p.response) return p.response;
  if (p.data.decision === "REJECT" && !p.data.note?.trim()) return apiError("NOTE_REQUIRED", "Say why the document is rejected", 400, "note");
  const d = await db.document.findUnique({ where: { id: params.id } });
  if (!d) return apiError("NOT_FOUND", "Document not found", 404);
  if (d.status === "VERIFIED") return apiError("CONFLICT", "A verified document cannot be changed; upload a replacement", 409);
  const status = p.data.decision === "VERIFY" ? "VERIFIED" : "REJECTED";
  await db.document.update({ where: { id: d.id }, data: { status, note: p.data.note ?? null, verifiedById: staff.user.id, verifiedAt: new Date() } });
  await db.auditLog.create({ data: { organizationId: d.organizationId, userId: staff.user.id, action: `document.${status.toLowerCase()}`, resourceType: "Document", resourceId: d.id, metadata: { type: d.type, note: p.data.note ?? null } } });
  await emitWebhookEvent({ organizationId: d.organizationId, event: "document.verified", data: { document_id: d.id, type: d.type, transfer_id: d.transferId, status } }).catch(() => {});
  return apiSuccess({ id: d.id, status });
}
