// Inbound email ingestion: banks, DGFT/ICEGATE notices and partners often send certificates by email. A forwarder (Resend/Postmark/Mailgun
// inbound, or your own mailbox rule) POSTs each message here, signed with INBOUND_EMAIL_SECRET. Fail closed: only allow-listed senders are
// accepted, a message is matched to exactly one transfer or queued for staff, and a certificate that arrives this way is stored as
// RECEIVED (awaiting a staff check), never VERIFIED automatically.
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { sniffFile } from "@/lib/storage";
import { addDocument } from "./service";
import type { DocType } from "./types";

export interface InboundPayload { message_id: string; from: string; subject: string; text?: string; attachments?: { filename: string; content_type?: string; content_base64: string }[] }

export function verifySignature(raw: string, header: string | null, secret = process.env.INBOUND_EMAIL_SECRET): boolean {
  if (!secret || !header) return false;
  const given = header.replace(/^sha256=/, "");
  const want = createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(given), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** INBOUND_EMAIL_SENDERS="alerts@hdfcbank.example,@dgft.gov.in,@partner.example": exact addresses or @domain entries. Empty = nobody. */
export function senderAllowed(from: string, list = process.env.INBOUND_EMAIL_SENDERS ?? ""): boolean {
  const addr = (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
  return list.split(",").map(s => s.trim().toLowerCase()).filter(Boolean).some(e => (e.startsWith("@") ? addr.endsWith(e) : addr === e));
}

export function detectType(...hay: string[]): DocType {
  const s = hay.join(" ").toLowerCase();
  if (/e-?brc|electronic bank realisation|electronic bank realization/.test(s)) return "EBRC";
  if (/\bbrc\b|bank realisation certificate|bank realization certificate/.test(s)) return "BRC";
  if (/e-?fira|electronic foreign inward/.test(s)) return "EFIRA";
  if (/\bfirc\b|foreign inward remittance certificate/.test(s)) return "FIRC";
  if (/\birm\b|inward remittance message|edpms/.test(s)) return "IRM";
  if (/certificate|confirmation|swift|mt103/.test(s)) return "BANK_CERT";
  return "OTHER";
}

/** Certificate number after the type word, e.g. "eBRC No. 2026ABC/12345". */
export function extractNumber(text: string): string | null {
  const m = /(?:e-?brc|brc|e-?fira|firc|irm|certificate)\s*(?:no\.?|number|#|ref(?:erence)?)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/\-]{5,39})/i.exec(text);
  return m ? m[1] : null;
}

/** Reference-looking tokens (transfer ids, partner refs, eFIRA numbers) to look up. */
export function candidateRefs(text: string): string[] {
  return Array.from(new Set((text.match(/[A-Za-z0-9][A-Za-z0-9_\/\-]{7,39}/g) ?? []).filter(t => /\d/.test(t)))).slice(0, 60);
}

export async function processInbound(p: InboundPayload): Promise<{ status: "MATCHED" | "UNMATCHED" | "AMBIGUOUS" | "REJECTED" | "DUPLICATE"; transferId?: string; documents: string[]; note?: string }> {
  const dup = await db.inboundMessage.findUnique({ where: { messageId: p.message_id } });
  if (dup) return { status: "DUPLICATE", documents: [] };
  const from = p.from.slice(0, 200), subject = (p.subject ?? "").slice(0, 300);
  const save = (status: string, note: string | null, transferId?: string, documentIds: string[] = []) =>
    db.inboundMessage.create({ data: { messageId: p.message_id.slice(0, 300), fromAddr: from, subject, status, note, transferId: transferId ?? null, documentIds } });
  if (!senderAllowed(from)) { await save("REJECTED", "sender not on the allow-list"); return { status: "REJECTED", documents: [], note: "sender not allowed" }; }

  const text = `${subject}\n${p.text ?? ""}`;
  const tokens = candidateRefs(text);
  const matches = tokens.length ? await db.transfer.findMany({ where: { OR: [{ id: { in: tokens } }, { externalRef: { in: tokens } }, { efiraRef: { in: tokens } }] }, select: { id: true, organizationId: true }, take: 3 }) : [];
  if (matches.length === 0) { await save("UNMATCHED", "no transfer reference found in the message"); return { status: "UNMATCHED", documents: [], note: "queued for staff" }; }
  if (matches.length > 1) { await save("AMBIGUOUS", `matches ${matches.length} transfers`); return { status: "AMBIGUOUS", documents: [], note: "queued for staff" }; }
  const t = matches[0];

  const docs: string[] = [];
  const atts = (p.attachments ?? []).slice(0, 5);
  const number = extractNumber(text);
  const issuer = (/<([^>]+)>/.exec(from)?.[1] ?? from).split("@").pop() ?? from;
  for (const a of atts) {
    const data = Buffer.from(a.content_base64 ?? "", "base64");
    if (!data.length || !sniffFile(data)) continue; // only PDF/PNG/JPEG, judged by content
    const type = detectType(a.filename, subject);
    const d = await addDocument({ organizationId: t.organizationId, transferId: t.id, type, number, issuer, refs: { message_id: p.message_id, from }, source: "EMAIL", file: { data, name: a.filename }, status: "RECEIVED" }).catch(() => null);
    if (d) docs.push(d.id);
  }
  if (!atts.length && number) { // a reference-only notice ("your eBRC number is ...")
    const d = await addDocument({ organizationId: t.organizationId, transferId: t.id, type: detectType(subject, text), number, issuer, refs: { message_id: p.message_id, from }, source: "EMAIL", status: "RECEIVED" }).catch(() => null);
    if (d) docs.push(d.id);
  }
  if (!docs.length) { await save("UNMATCHED", "matched a transfer but carried no usable attachment or certificate number", t.id); return { status: "UNMATCHED", transferId: t.id, documents: [], note: "queued for staff" }; }
  await save("MATCHED", null, t.id, docs);
  return { status: "MATCHED", transferId: t.id, documents: docs };
}
