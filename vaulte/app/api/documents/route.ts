// GET /api/documents?transfer_id=&type= — list. POST (multipart) — add a certificate/proof: type, transfer_id?, number?, issuer?, issued_on?, file?.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { hit } from "@/lib/security/ratelimit-db";
import { addDocument, presentDocument } from "@/lib/documents/service";
import { UPLOADABLE } from "@/lib/documents/types";
import { docErrorResponse, orgContext } from "@/lib/documents/api";

export async function GET(req: NextRequest) {
  const c = await orgContext(req);
  if (c.response) return c.response;
  const q = req.nextUrl.searchParams;
  const rows = await db.document.findMany({ where: { organizationId: c.orgId, ...(q.get("transfer_id") ? { transferId: q.get("transfer_id")! } : {}), ...(q.get("type") ? { type: q.get("type")! } : {}) }, orderBy: { createdAt: "desc" }, take: 200 });
  return apiSuccess({ data: rows.map(presentDocument) });
}

export async function POST(req: NextRequest) {
  const c = await orgContext(req, { write: true });
  if (c.response) return c.response;
  const lim = await hit(`doc:upload:${c.orgId}`, 120, 3600);
  if (!lim.allowed) return apiError("RATE_LIMITED", "Too many uploads. Try again later.", 429);
  try {
    const form = await req.formData();
    const type = String(form.get("type") ?? "");
    if (!(UPLOADABLE as string[]).includes(type)) return apiError("VALIDATION_ERROR", `type must be one of ${UPLOADABLE.join(", ")}`, 400, "type");
    const f = form.get("file");
    const file = f instanceof File && f.size > 0 ? { data: Buffer.from(await f.arrayBuffer()), name: f.name } : undefined;
    const s = (k: string) => { const v = form.get(k); return typeof v === "string" && v.trim() ? v.trim() : null; };
    const doc = await addDocument({ organizationId: c.orgId, type, transferId: s("transfer_id"), invoiceId: s("invoice_id"), number: s("number"), issuer: s("issuer"), issuedOn: s("issued_on"), refs: Object.fromEntries(["edpms_ref", "irm_number", "shipping_bill", "dgft_ref"].map(k => [k, s(k)]).filter(([, v]) => v) as [string, string][]), source: "UPLOAD", file, uploadedById: c.userId });
    return apiSuccess(presentDocument(doc), 201);
  } catch (e) {
    const r = docErrorResponse(e); if (r) return r;
    throw e;
  }
}
