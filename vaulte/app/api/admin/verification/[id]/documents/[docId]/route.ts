import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";
import { loadDecrypted } from "@/lib/storage";
import { audit, loadCase } from "@/lib/kyc/service";
import { handleError, parseJson } from "@/lib/kyc/api";

export async function GET(req: NextRequest, { params }: { params: { id: string; docId: string } }) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  const c = await loadCase(params.id);
  const d = c?.documents.find(x => x.id === params.docId);
  if (!c || !d) return apiError("NOT_FOUND", "Document not found", 404);
  const data = await loadDecrypted(d.storageKey);
  await audit(c.organizationId, staff.user.id, "verification.document_viewed_by_staff", c.id, { document_id: d.id, type: d.type });
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": d.mime, "Content-Disposition": `inline; filename="${d.filename}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Security-Policy": "sandbox" },
  });
}

const Body = z.object({ status: z.enum(["ACCEPTED", "REJECTED"]), reason: z.string().max(300).optional() });

export async function POST(req: NextRequest, { params }: { params: { id: string; docId: string } }) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  const p = await parseJson(req, Body);
  if (p.response) return p.response;
  if (p.data.status === "REJECTED" && !p.data.reason?.trim()) return apiError("NOTE_REQUIRED", "Say why the document is rejected", 400, "reason");
  const c = await loadCase(params.id);
  const d = c?.documents.find(x => x.id === params.docId);
  if (!c || !d) return apiError("NOT_FOUND", "Document not found", 404);
  if (c.status !== "IN_REVIEW") return apiError("NOT_IN_REVIEW", "Documents can only be reviewed while the case is in review", 409);
  try {
    await db.verificationDocument.update({ where: { id: d.id }, data: { status: p.data.status, rejectReason: p.data.status === "REJECTED" ? p.data.reason : null } });
    await audit(c.organizationId, staff.user.id, `verification.document_${p.data.status.toLowerCase()}`, c.id, { document_id: d.id, type: d.type });
    return apiSuccess({ document_id: d.id, status: p.data.status });
  } catch (e) { return handleError(e); }
}
