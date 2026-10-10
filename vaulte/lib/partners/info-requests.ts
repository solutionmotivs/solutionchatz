// The partner's own questions (RFIs) for a customer, answered inside Vaulte so nobody is contacted separately. Documents are forwarded to the
// partner in the same call and are not kept by Vaulte; the audit log records that an answer was sent, never what it said.
import { db } from "@/lib/db";
import { PartnerError } from "@/lib/psp/http";
import { getPartner } from "@/lib/psp/stablecoin/registry";
import type { InfoAnswer, InfoRequest } from "@/lib/psp/stablecoin/partner";

export const MAX_FILE_BYTES = 7 * 1024 * 1024;
const MIMES = new Set(["application/pdf", "image/png", "image/jpeg"]);

export class InfoRequestError extends Error { constructor(public code: string, message: string, public status = 400) { super(message); } }

async function rowFor(orgId: string, id: string) {
  const row = await db.partnerCustomer.findFirst({ where: { id, organizationId: orgId } });
  if (!row) throw new InfoRequestError("NOT_FOUND", "No such partner approval", 404);
  if (!row.partnerRef) throw new InfoRequestError("NOT_SUBMITTED", "This partner has not received your details yet", 409);
  return row;
}

export async function listInfoRequests(orgId: string, id: string): Promise<InfoRequest[]> {
  const row = await rowFor(orgId, id);
  const adapter = getPartner(row.partner);
  if (!adapter.listInfoRequests) return [];
  try { return await adapter.listInfoRequests(row.partnerRef!); }
  catch (e) { if (e instanceof PartnerError && e.status < 500) return []; throw e; }
}

/** Checks the answer's shape and size before anything leaves Vaulte. */
export function validateAnswer(a: InfoAnswer): InfoAnswer {
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(a.values ?? {})) { if (typeof v !== "string" || v.length > 2000) throw new InfoRequestError("VALIDATION_ERROR", `${k} is too long`); values[k.slice(0, 60)] = v; }
  const files: InfoAnswer["files"] = {};
  let total = 0;
  for (const [k, f] of Object.entries(a.files ?? {})) {
    if (!MIMES.has(f.mime)) throw new InfoRequestError("VALIDATION_ERROR", "Documents must be a PDF, PNG or JPEG file");
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(f.dataBase64)) throw new InfoRequestError("VALIDATION_ERROR", "The document could not be read");
    const bytes = Math.floor(f.dataBase64.replace(/\s/g, "").length * 3 / 4);
    total += bytes;
    if (bytes > MAX_FILE_BYTES || total > 9 * 1024 * 1024) throw new InfoRequestError("FILE_TOO_LARGE", "Documents can be up to 7 MB each and 9 MB together", 413);
    files[k.slice(0, 60)] = { name: f.name.replace(/[^\w.\- ]/g, "_").slice(0, 120) || "document", mime: f.mime, dataBase64: f.dataBase64.replace(/\s/g, "") };
  }
  return { values, files };
}

export async function answerInfoRequest(orgId: string, userId: string | undefined, id: string, requestId: string, answer: InfoAnswer): Promise<void> {
  const row = await rowFor(orgId, id);
  const adapter = getPartner(row.partner);
  if (!adapter.answerInfoRequest) throw new InfoRequestError("NOT_SUPPORTED", "This partner takes answers outside Vaulte", 409);
  const clean = validateAnswer(answer);
  try { await adapter.answerInfoRequest(row.partnerRef!, requestId, clean); }
  catch (e) {
    if (e instanceof PartnerError && e.status >= 400 && e.status < 500) throw new InfoRequestError(e.code === "ALREADY_ANSWERED" ? "ALREADY_ANSWERED" : "PARTNER_REJECTED", e.message.replace(/^Nium \S+ failed: /, ""), e.status === 404 ? 404 : 409);
    if (e instanceof Error && /^INFO_REQUEST_(INCOMPLETE|UNSUPPORTED)/.test(e.message)) throw new InfoRequestError(e.message.startsWith("INFO_REQUEST_INCOMPLETE") ? "VALIDATION_ERROR" : "NOT_SUPPORTED", e.message.replace(/^INFO_REQUEST_\w+: /, ""), 400);
    throw e;
  }
  await db.partnerCustomer.update({ where: { id: row.id }, data: { status: "SUBMITTED", actionUrl: null, note: "Your answer was sent to the partner; its decision arrives here" } });
  await db.auditLog.create({ data: { organizationId: orgId, userId: userId ?? null, action: "partner_customer.info_answered", resourceType: "PartnerCustomer", resourceId: row.id, metadata: { partner: row.partner, request_id: requestId, files: Object.keys(clean.files).length } } });
}
