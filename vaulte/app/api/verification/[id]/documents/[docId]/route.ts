import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { loadDecrypted } from "@/lib/storage";
import { assertEditable, audit, loadCase, presentCase } from "@/lib/kyc/service";
import { customerCase, handleError } from "@/lib/kyc/api";

/** Download (the customer's own documents only; staff use the admin route). */
export async function GET(req: NextRequest, { params }: { params: { id: string; docId: string } }) {
  const r = await customerCase(req, params.id);
  if (r.response) return r.response;
  const d = r.c.documents.find(x => x.id === params.docId);
  if (!d) return apiError("NOT_FOUND", "Document not found", 404);
  const data = await loadDecrypted(d.storageKey);
  await audit(r.c.organizationId, r.user.id, "verification.document_downloaded", r.c.id, { document_id: d.id });
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": d.mime, "Content-Disposition": `attachment; filename="${d.filename}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" },
  });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string; docId: string } }) {
  const r = await customerCase(req, params.id, { edit: true });
  if (r.response) return r.response;
  try {
    assertEditable(r.c);
    const d = r.c.documents.find(x => x.id === params.docId);
    if (!d) return apiError("NOT_FOUND", "Document not found", 404);
    if (d.status === "ACCEPTED") return apiError("CONFLICT", "An accepted document cannot be removed", 409);
    await db.verificationDocument.delete({ where: { id: d.id } });
    // The encrypted object is kept for the retention period (AML records); only the link is removed.
    return apiSuccess(presentCase((await loadCase(r.c.id))!));
  } catch (e) { return handleError(e); }
}
