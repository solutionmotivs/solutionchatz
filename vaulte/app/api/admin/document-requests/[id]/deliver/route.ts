// POST /api/admin/document-requests/:id/deliver (multipart: number?, issuer?, issued_on?, file?) — staff attach the certificate the bank/partner sent.
// The document is stored verified (staff checked it against the issuer's message) and the request closes itself.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";
import { docErrorResponse } from "@/lib/documents/api";
import { addDocument, presentDocument } from "@/lib/documents/service";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireStaff(req);
  if (g.response) return g.response;
  const r = await db.documentRequest.findUnique({ where: { id: params.id } });
  if (!r) return apiError("NOT_FOUND", "Request not found", 404);
  if (!["REQUESTED", "IN_PROGRESS"].includes(r.status)) return apiError("CLOSED", `This request is already ${r.status.toLowerCase()}`, 409);
  try {
    const form = await req.formData();
    const s = (k: string) => { const v = form.get(k); return typeof v === "string" && v.trim() ? v.trim() : null; };
    const f = form.get("file");
    const file = f instanceof File && f.size > 0 ? { data: Buffer.from(await f.arrayBuffer()), name: f.name } : undefined;
    const doc = await addDocument({ organizationId: r.organizationId, transferId: r.transferId, type: r.type, number: s("number"), issuer: s("issuer"), issuedOn: s("issued_on"), source: "UPLOAD", file, uploadedById: g.user.id, status: "VERIFIED" });
    if (r.type === "EFIRA" && doc.number) await db.transfer.updateMany({ where: { id: r.transferId, efiraRef: null }, data: { efiraRef: doc.number } });
    await db.auditLog.create({ data: { organizationId: r.organizationId, userId: g.user.id, action: "document.request_delivered", resourceType: "DocumentRequest", resourceId: r.id, metadata: { document_id: doc.id } } });
    return apiSuccess({ document: presentDocument(doc), request: (await db.documentRequest.findUnique({ where: { id: r.id } }))?.status }, 201);
  } catch (e) { const x = docErrorResponse(e); if (x) return x; throw e; }
}
