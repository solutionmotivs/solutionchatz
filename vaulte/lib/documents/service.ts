import { db } from "@/lib/db";
import { emitWebhookEvent } from "@/lib/webhooks/dispatch";
import { MAX_UPLOAD_BYTES, safeFilename, saveEncrypted, sniffFile } from "@/lib/storage";
import { isDocType, type DocType } from "./types";

export class DocError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export interface AddDocInput {
  organizationId: string;
  type: string;
  transferId?: string | null;
  invoiceId?: string | null;
  number?: string | null;
  issuer?: string | null;
  issuedOn?: string | null;
  refs?: Record<string, string>;
  source: "UPLOAD" | "PARTNER" | "GENERATED" | "EMAIL" | "RECONCILIATION" | "POLL";
  file?: { data: Buffer; name: string };
  uploadedById?: string | null;
  /** Partner-delivered certificates are trusted as received; customer uploads wait for a staff check. */
  status?: "RECEIVED" | "VERIFIED";
}

export async function addDocument(i: AddDocInput) {
  if (!isDocType(i.type)) throw new DocError("INVALID_TYPE", "Unknown document type");
  if (i.number && i.number.length > 80) throw new DocError("VALIDATION_ERROR", "Number is too long");
  if (i.transferId) {
    const t = await db.transfer.findFirst({ where: { id: i.transferId, organizationId: i.organizationId }, select: { id: true } });
    if (!t) throw new DocError("NOT_FOUND", "Transfer not found", 404);
  }
  let issuedOn: Date | null = null;
  if (i.issuedOn) { issuedOn = new Date(i.issuedOn); if (isNaN(issuedOn.getTime()) || issuedOn.getTime() > Date.now() + 86400000) throw new DocError("VALIDATION_ERROR", "Issue date is not valid"); }
  let fileData: { filename: string; mime: string; size: number; sha256: string; storageKey: string } | null = null;
  if (i.file) {
    if (i.file.data.length === 0) throw new DocError("VALIDATION_ERROR", "The file is empty");
    if (i.file.data.length > MAX_UPLOAD_BYTES) throw new DocError("FILE_TOO_LARGE", "Files can be at most 8 MB", 413);
    const kind = sniffFile(i.file.data);
    if (!kind) throw new DocError("UNSUPPORTED_FILE", "Only PDF, PNG and JPEG files are accepted", 415);
    const saved = await saveEncrypted(i.file.data, `docs/${i.organizationId}/${i.transferId ?? "general"}`);
    fileData = { filename: safeFilename(i.file.name, kind.ext), mime: kind.mime, size: i.file.data.length, sha256: saved.sha256, storageKey: saved.key };
  }
  if (!fileData && !i.number) throw new DocError("VALIDATION_ERROR", "Provide a file, a certificate number, or both");
  const doc = await db.document.create({
    data: {
      organizationId: i.organizationId, transferId: i.transferId ?? null, invoiceId: i.invoiceId ?? null, type: i.type, issuer: i.issuer ?? null, number: i.number ?? null,
      issuedOn, refs: i.refs ?? {}, source: i.source, status: i.status ?? "RECEIVED", uploadedById: i.uploadedById ?? null, ...(fileData ?? {}),
      ...(i.status === "VERIFIED" ? { verifiedAt: new Date() } : {}),
    },
  });
  await db.auditLog.create({ data: { organizationId: i.organizationId, userId: i.uploadedById ?? null, action: "document.added", resourceType: "Document", resourceId: doc.id, metadata: { type: i.type, source: i.source, transfer_id: i.transferId ?? null, has_file: !!fileData } } });
  const { fulfilOpenRequests } = await import("./requests");
  await fulfilOpenRequests(doc).catch(() => {});
  await emitWebhookEvent({ organizationId: i.organizationId, event: "document.received", data: { document_id: doc.id, type: doc.type, transfer_id: doc.transferId, number: doc.number, status: doc.status } }).catch(() => {});
  return doc;
}

/** Called when a payout completes with an eFIRA reference from the partner: record it as a document. */
export async function recordEfiraReference(t: { id: string; organizationId: string; destCountry: string }, ref: string | null | undefined, issuer?: string) {
  if (!ref || t.destCountry !== "IN") return null;
  const exists = await db.document.findFirst({ where: { transferId: t.id, type: "EFIRA", number: ref } });
  if (exists) return exists;
  return addDocument({ organizationId: t.organizationId, transferId: t.id, type: "EFIRA", number: ref, issuer: issuer ?? "Licensed partner", source: "PARTNER", status: "VERIFIED" });
}

export function presentDocument(d: { id: string; createdAt: Date; type: string; issuer: string | null; number: string | null; issuedOn: Date | null; refs: unknown; source: string; status: string; note: string | null; filename: string | null; mime: string | null; size: number | null; sha256: string | null; transferId: string | null; invoiceId: string | null; verifiedAt: Date | null }) {
  return { id: d.id, type: d.type, issuer: d.issuer, number: d.number, issued_on: d.issuedOn, refs: d.refs, source: d.source, status: d.status, note: d.note, has_file: !!d.filename, filename: d.filename, mime: d.mime, size: d.size, sha256: d.sha256, transfer_id: d.transferId, invoice_id: d.invoiceId, verified_at: d.verifiedAt, created_at: d.createdAt };
}

export type { DocType };
