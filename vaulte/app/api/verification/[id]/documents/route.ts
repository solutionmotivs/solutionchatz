// POST /api/verification/:id/documents — multipart upload (fields: type, person_id?, file). Stored encrypted.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { hit } from "@/lib/security/ratelimit-db";
import { MAX_UPLOAD_BYTES, safeFilename, saveEncrypted, sniffFile } from "@/lib/storage";
import { assertEditable, audit, loadCase, ocrDocument, presentCase, requirementsOfCase } from "@/lib/kyc/service";
import { customerCase, handleError } from "@/lib/kyc/api";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await customerCase(req, params.id, { edit: true });
  if (r.response) return r.response;
  const lim = await hit(`kyc:upload:${r.user.organizationId}`, 60, 3600);
  if (!lim.allowed) return apiError("RATE_LIMITED", "Too many uploads. Try again later.", 429);
  try {
    assertEditable(r.c);
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_UPLOAD_BYTES + 64 * 1024) return apiError("FILE_TOO_LARGE", "Files can be at most 8 MB", 413);
    const form = await req.formData();
    const type = String(form.get("type") ?? "");
    const personId = (form.get("person_id") as string | null) || null;
    const file = form.get("file");
    if (!(file instanceof File)) return apiError("VALIDATION_ERROR", "A file is required", 400, "file");
    const spec = requirementsOfCase(r.c).documents.find(d => d.type === type);
    if (!spec) return apiError("VALIDATION_ERROR", "This document type is not requested for this verification", 400, "type");
    if (personId && !r.c.people.some(p => p.id === personId)) return apiError("VALIDATION_ERROR", "Unknown person", 400, "person_id");
    if (spec.perPerson && !personId) return apiError("VALIDATION_ERROR", "Choose which person this document belongs to", 400, "person_id");
    if (file.size === 0) return apiError("VALIDATION_ERROR", "The file is empty", 400, "file");
    if (file.size > MAX_UPLOAD_BYTES) return apiError("FILE_TOO_LARGE", "Files can be at most 8 MB", 413);
    if (r.c.documents.length >= 60) return apiError("LIMIT", "Too many documents on this verification", 400);
    const data = Buffer.from(await file.arrayBuffer());
    const kind = sniffFile(data);
    if (!kind) return apiError("UNSUPPORTED_FILE", "Only PDF, PNG and JPEG files are accepted", 415, "file");
    const { key, sha256 } = await saveEncrypted(data, `kyc/${r.c.organizationId}/${r.c.id}`);
    // One live document per (type, person): a new upload replaces a rejected/older one.
    const old = r.c.documents.filter(d => d.type === type && (d.personId ?? null) === personId && d.status !== "ACCEPTED");
    await db.verificationDocument.deleteMany({ where: { id: { in: old.map(d => d.id) } } });
    const created = await db.verificationDocument.create({
      data: { caseId: r.c.id, personId, type, filename: safeFilename(file.name, kind.ext), mime: kind.mime, size: data.length, sha256, storageKey: key, uploadedById: r.user.id },
    });
    const ocr = await ocrDocument(created.id, type, data, kind.mime).catch(() => null);
    await audit(r.c.organizationId, r.user.id, "verification.document_uploaded", r.c.id, { type, size: data.length, ocr: (ocr as { status?: string } | null)?.status ?? null });
    return apiSuccess(presentCase((await loadCase(r.c.id))!), 201);
  } catch (e) { return handleError(e); }
}
