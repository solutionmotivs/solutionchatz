// Certificate requests: the customer asks, Vaulte routes the ask to the issuer (partner / bank), and the request closes
// automatically when a matching document is added to the transfer. Vaulte never issues these certificates.
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/sender";
import type { EmailTemplate } from "@/lib/email/templates";
import { emitWebhookEvent } from "@/lib/webhooks/dispatch";
import { DOC_TYPES, type DocType } from "./types";
import { DocError } from "./service";

export const REQUESTABLE = ["EFIRA", "FIRC", "EBRC", "BRC", "BANK_CERT"] as const;
export type Requestable = (typeof REQUESTABLE)[number];
const OPEN = ["REQUESTED", "IN_PROGRESS"];
const INDIAN_ONLY = new Set<string>(["EFIRA", "FIRC", "EBRC", "BRC"]);

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const mail = (subject: string, text: string): EmailTemplate => ({ subject, text, html: `<p style="font-family:sans-serif;font-size:14px;line-height:1.5">${esc(text).replace(/\n/g, "<br>")}</p>` });

export async function createRequest(organizationId: string, transferId: string, type: string, note: string | undefined, userId?: string) {
  if (!(REQUESTABLE as readonly string[]).includes(type)) throw new DocError("INVALID_TYPE", `You can request: ${REQUESTABLE.join(", ")}`);
  const t = await db.transfer.findFirst({ where: { id: transferId, organizationId } });
  if (!t) throw new DocError("NOT_FOUND", "Transfer not found", 404);
  if (t.status !== "COMPLETED") throw new DocError("NOT_COMPLETED", "Certificates can be requested once the payout has completed", 409);
  if (INDIAN_ONLY.has(type) && t.destCountry !== "IN") throw new DocError("NOT_APPLICABLE", `${type} applies to payments received in India`, 409);
  const have = await db.document.findFirst({ where: { transferId, organizationId, type, status: { not: "REJECTED" } }, orderBy: { createdAt: "desc" } });
  if (have) throw new DocError("ALREADY_AVAILABLE", `A ${type} is already on file for this transfer (document ${have.id})`, 409);
  const open = await db.documentRequest.findFirst({ where: { organizationId, transferId, type, status: { in: OPEN } } });
  if (open) return { request: open, created: false };
  const cleanNote = note?.trim().slice(0, 500) || null;
  const request = await db.documentRequest.create({ data: { organizationId, transferId, type, note: cleanNote, requestedById: userId ?? null } });
  await db.auditLog.create({ data: { organizationId, userId: userId ?? null, action: "document.requested", resourceType: "DocumentRequest", resourceId: request.id, metadata: { type, transfer_id: transferId } } });
  await emitWebhookEvent({ organizationId, event: "document.requested", data: { request_id: request.id, type, transfer_id: transferId } }).catch(() => {});
  if (process.env.OPS_EMAIL) {
    await sendEmail({ to: process.env.OPS_EMAIL, template: mail(`Certificate request: ${type} for transfer ${transferId.slice(-8)}`, `A customer requested a ${DOC_TYPES[type as DocType].label}.\nTransfer: ${transferId}\nOrganization: ${organizationId}\nNote: ${cleanNote ?? "-"}\n\nAsk the issuing partner/bank, then add the document to the transfer (it closes this request automatically).`) }).catch(() => {});
  }
  return { request, created: true };
}

export const presentRequest = (r: { id: string; createdAt: Date; updatedAt: Date; type: string; status: string; note: string | null; staffNote: string | null; transferId: string; fulfilledDocumentId: string | null; fulfilledAt: Date | null }) => ({
  id: r.id, type: r.type, label: DOC_TYPES[r.type as DocType]?.label ?? r.type, status: r.status, note: r.note, staff_note: r.staffNote, transfer_id: r.transferId,
  document_id: r.fulfilledDocumentId, fulfilled_at: r.fulfilledAt?.toISOString() ?? null, created_at: r.createdAt.toISOString(), updated_at: r.updatedAt.toISOString(),
});

/** Called whenever a document is added: close matching open requests and tell the customer. */
export async function fulfilOpenRequests(doc: { id: string; type: string; transferId: string | null; organizationId: string }) {
  if (!doc.transferId) return 0;
  const open = await db.documentRequest.findMany({ where: { organizationId: doc.organizationId, transferId: doc.transferId, type: doc.type, status: { in: OPEN } } });
  for (const r of open) {
    await db.documentRequest.update({ where: { id: r.id }, data: { status: "FULFILLED", fulfilledDocumentId: doc.id, fulfilledAt: new Date() } });
    const requester = r.requestedById ? await db.user.findUnique({ where: { id: r.requestedById }, select: { email: true } }) : null;
    if (requester?.email) await sendEmail({ to: requester.email, organizationId: doc.organizationId, template: mail(`Your ${doc.type} is available`, `The ${DOC_TYPES[doc.type as DocType]?.label ?? doc.type} you requested for transfer ${doc.transferId.slice(-8)} is now on file. Open the transfer's documents page in your dashboard to download it.`) }).catch(() => {});
  }
  return open.length;
}

export async function staffUpdateRequest(id: string, staffId: string, status: "IN_PROGRESS" | "REJECTED" | "CANCELLED", staffNote?: string) {
  const r = await db.documentRequest.findUnique({ where: { id } });
  if (!r) throw new DocError("NOT_FOUND", "Request not found", 404);
  if (!OPEN.includes(r.status)) throw new DocError("CLOSED", `This request is already ${r.status.toLowerCase()}`, 409);
  if (status === "REJECTED" && !staffNote?.trim()) throw new DocError("NOTE_REQUIRED", "Say why the request is rejected so the customer knows what to do", 400);
  const u = await db.documentRequest.update({ where: { id }, data: { status, staffNote: staffNote?.trim().slice(0, 500) ?? r.staffNote } });
  await db.auditLog.create({ data: { organizationId: r.organizationId, userId: staffId, action: `document.request_${status.toLowerCase()}`, resourceType: "DocumentRequest", resourceId: id, metadata: { type: r.type } } });
  return u;
}
