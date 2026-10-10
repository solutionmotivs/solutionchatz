// EDPMS / IRM reconciliation: staff import the bank's inward-remittance (IRM) or eBRC report as CSV. Rows are matched to completed transfers
// by an explicit reference first, then by amount + currency + date window. Anything not matched exactly once is reported, never guessed.
import { db } from "@/lib/db";
import { addDocument } from "./service";
import { CsvStream } from "@/lib/sanctions/parsers";

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
const COLS: Record<string, string[]> = {
  irm: ["irm", "irm_number", "irm_no", "irm_ref"], ebrc: ["ebrc", "ebrc_number", "ebrc_no", "brc_number"], firc: ["firc", "firc_number", "efira", "efira_number", "firc_no"],
  ref: ["reference", "bank_ref", "bank_reference", "utr", "transfer_reference", "partner_ref", "remittance_reference"],
  amount: ["amount", "remittance_amount", "fcy_amount", "amount_fcy"], currency: ["currency", "ccy", "fcy", "currency_code"], date: ["date", "remittance_date", "irm_date", "credit_date"],
};

export interface ReconcileResult { rows: number; matched: number; documents: number; unmatched: { row: number; reason: string }[] }

function parseRows(csv: string): Record<string, string>[] {
  const rows: string[][] = []; const s = new CsvStream(r => rows.push(r)); s.feed(csv); s.end();
  if (rows.length < 2) return [];
  const head = rows[0].map(norm);
  const idx: Record<string, number> = {};
  for (const [k, names] of Object.entries(COLS)) { const i = head.findIndex(h => names.includes(h)); if (i >= 0) idx[k] = i; }
  return rows.slice(1).filter(r => r.some(c => c.trim())).map(r => Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, (r[i] ?? "").trim()])));
}

export async function reconcileEdpms(csv: string, staffId: string, staffOrgId: string): Promise<ReconcileResult> {
  const rows = parseRows(csv).slice(0, 2000);
  const out: ReconcileResult = { rows: rows.length, matched: 0, documents: 0, unmatched: [] };
  for (const [i, r] of rows.entries()) {
    const n = i + 2; // spreadsheet row number (header = 1)
    if (!r.irm && !r.ebrc && !r.firc) { out.unmatched.push({ row: n, reason: "no IRM, eBRC or FIRC/eFIRA number in the row" }); continue; }
    let candidates: { id: string; organizationId: string }[] = [];
    if (r.ref) candidates = await db.transfer.findMany({ where: { status: "COMPLETED", destCountry: "IN", OR: [{ id: r.ref }, { externalRef: r.ref }, { efiraRef: r.ref }] }, select: { id: true, organizationId: true }, take: 2 });
    if (candidates.length === 0 && r.amount && r.currency && r.date) {
      const when = new Date(r.date); const amt = Math.round(Number(r.amount.replace(/,/g, "")) * 100);
      if (!isNaN(when.getTime()) && Number.isFinite(amt)) {
        candidates = await db.transfer.findMany({ where: { status: "COMPLETED", destCountry: "IN", sourceCurrency: r.currency.toUpperCase(), sourceAmount: BigInt(amt), completedAt: { gte: new Date(when.getTime() - 3 * 86_400_000), lte: new Date(when.getTime() + 4 * 86_400_000) } }, select: { id: true, organizationId: true }, take: 2 });
      }
    }
    if (candidates.length !== 1) { out.unmatched.push({ row: n, reason: candidates.length === 0 ? "no completed transfer matches this row" : "more than one transfer matches; add a reference column" }); continue; }
    const t = candidates[0]; let added = 0;
    for (const [type, number] of [["IRM", r.irm], ["EBRC", r.ebrc], ["FIRC", r.firc]] as const) {
      if (!number) continue;
      if (await db.document.findFirst({ where: { transferId: t.id, type, number } })) continue;
      // Staff-imported from the bank's own report: stored verified, attributable to the staff member in the audit log.
      await addDocument({ organizationId: t.organizationId, transferId: t.id, type, number, issuer: "Authorised dealer bank (EDPMS report)", issuedOn: r.date ? new Date(r.date).toISOString().slice(0, 10) : undefined, refs: { import: "EDPMS CSV" }, source: "RECONCILIATION", status: "VERIFIED", uploadedById: staffId }).catch(() => null);
      added++;
    }
    if (added) { out.matched++; out.documents += added; } else out.unmatched.push({ row: n, reason: "already on file" });
  }
  await db.auditLog.create({ data: { organizationId: staffOrgId, userId: staffId, action: "documents.edpms_import", resourceType: "Document", resourceId: "bulk", metadata: { rows: out.rows, matched: out.matched, documents: out.documents } } });
  return out;
}
