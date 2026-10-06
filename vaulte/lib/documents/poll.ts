// Certificate auto-update: ask the payout partner for the certificates it holds (eFIRA/FIRC/eBRC/bank confirmations) and file what it has.
// A document the partner hands over through its API is stored VERIFIED (it is the partner's own record, fetched over an authenticated call);
// documents from other channels (email, reconciliation) follow their own rules. Vaulte never issues these documents.
import { db } from "@/lib/db";
import { getPartner } from "@/lib/psp/stablecoin/registry";
import type { PartnerDocument } from "@/lib/psp/stablecoin/partner";
import type { Route } from "@/lib/stablecoin/types";
import { addDocument } from "./service";
import { isGoodsPurpose } from "./types";

const intervalMs = () => Math.max(1, Number(process.env.CERT_POLL_INTERVAL_MIN ?? 360)) * 60_000;

/** What a completed transfer to India still lacks. */
export function missingCertificates(t: { destCountry: string; kind: string; purposeCode: string | null }, docs: { type: string; status: string }[]): string[] {
  if (t.destCountry !== "IN" || t.kind !== "BUSINESS") return [];
  const has = (...types: string[]) => docs.some(d => types.includes(d.type) && d.status !== "REJECTED");
  const out: string[] = [];
  if (!has("EFIRA", "FIRC")) out.push("EFIRA");
  if (isGoodsPurpose(t.purposeCode) && !has("EBRC", "BRC")) out.push("EBRC");
  return out;
}

export async function pollTransfer(transferId: string): Promise<{ added: string[]; checked: string; error?: string }> {
  const t = await db.transfer.findUniqueOrThrow({ where: { id: transferId }, include: { } });
  const docs = await db.document.findMany({ where: { transferId: t.id }, select: { type: true, status: true, number: true } });
  const missing = missingCertificates(t, docs);
  const route = t.route as unknown as Route;
  const partnerId = route.legs[route.legs.length - 1].partner;
  let note = ""; const added: string[] = [];
  try {
    const partner = getPartner(partnerId);
    if (!partner.listDocuments) note = `${partnerId}: does not expose documents by API (waiting for email/staff)`;
    else {
      const found: PartnerDocument[] = await partner.listDocuments({ partnerRef: t.externalRef, transferId: t.id, destCountry: t.destCountry, purposeCode: t.purposeCode, completedAt: t.completedAt });
      for (const d of found) {
        if (docs.some(x => x.type === d.type && x.number === d.number)) continue;
        await addDocument({ organizationId: t.organizationId, transferId: t.id, type: d.type, number: d.number, issuedOn: d.issuedOn, issuer: partnerId, refs: d.refs, source: "POLL", file: d.file, status: "VERIFIED" });
        added.push(d.type);
      }
      note = `${partnerId}: ${found.length} document(s) offered, ${added.length} new`;
    }
  } catch (e) { note = `${partnerId}: ${e instanceof Error ? e.message.slice(0, 160) : "error"}`; await db.transfer.update({ where: { id: t.id }, data: { certCheckedAt: new Date(), certCheckNote: note } }); return { added, checked: partnerId, error: note }; }
  await db.transfer.update({ where: { id: t.id }, data: { certCheckedAt: new Date(), certCheckNote: `${note}${missing.length ? ` · still missing: ${missing.join(", ")}` : ""}` } });
  return { added, checked: partnerId };
}

/** Cron: look at completed India transfers that still lack a certificate and were not checked recently (or have an open customer request). */
export async function runCertificatePoll(opts: { limit?: number } = {}): Promise<{ checked: number; added: number; errors: number }> {
  const since = new Date(Date.now() - intervalMs());
  const candidates = await db.transfer.findMany({
    where: { status: "COMPLETED", destCountry: "IN", kind: "BUSINESS", OR: [{ certCheckedAt: null }, { certCheckedAt: { lt: since } }] },
    orderBy: { completedAt: "desc" }, take: Math.min(opts.limit ?? 100, 200), select: { id: true, destCountry: true, kind: true, purposeCode: true },
  });
  let checked = 0, added = 0, errors = 0;
  for (const c of candidates) {
    const docs = await db.document.findMany({ where: { transferId: c.id }, select: { type: true, status: true } });
    if (!missingCertificates(c, docs).length) continue;
    const r = await pollTransfer(c.id).catch(() => ({ added: [] as string[], checked: "", error: "failed" }));
    checked++; added += r.added.length; if (r.error) errors++;
  }
  return { checked, added, errors };
}
