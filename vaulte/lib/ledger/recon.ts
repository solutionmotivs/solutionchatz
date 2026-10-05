// Reconcile a partner's statement against what Vaulte booked. Exceptions go to a staff queue; nothing is auto-corrected.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { toMinor } from "./manual";
import { LedgerError } from "./gl";

export interface ReconInput {
  direction: "FUNDING" | "PAYOUT" | "FEE" | "OTHER";
  reference: string;
  currency: string;
  amount: string;
  date?: string;
  description?: string;
}

/** Statement amounts may differ by one minor unit of rounding. */
const TOLERANCE_MINOR = 1n;

export async function importStatement(opts: { partner: string; label?: string; uploadedBy: string; lines: ReconInput[] }) {
  if (!opts.lines.length) throw new LedgerError("The statement has no lines");
  if (opts.lines.length > 5000) throw new LedgerError("At most 5,000 lines per import");
  const batch = await db.reconBatch.create({ data: { partner: opts.partner, label: opts.label ?? null, uploadedBy: opts.uploadedBy } });
  const out = { batchId: batch.id, matched: 0, mismatched: 0, unmatched: 0 };
  for (const l of opts.lines) {
    const currency = l.currency.toUpperCase();
    const amount = toMinor(l.amount.replace(/^-/, ""), currency);
    const data: Prisma.ReconLineUncheckedCreateInput = {
      batchId: batch.id, direction: l.direction, reference: l.reference.trim(), currency, amountMinor: amount,
      occurredOn: l.date ? new Date(l.date) : null, description: l.description ?? null, status: "UNMATCHED",
    };
    if (l.direction === "PAYOUT" || l.direction === "FUNDING") {
      const t = await db.transfer.findFirst({ where: { OR: [{ externalRef: l.reference.trim() }, { id: l.reference.trim() }] } });
      if (t) {
        const expected = l.direction === "PAYOUT" ? t.destAmount : t.sourceAmount;
        const expectedCcy = l.direction === "PAYOUT" ? t.destCurrency : t.sourceCurrency;
        const diff = amount > expected ? amount - expected : expected - amount;
        data.transferId = t.id; data.expectedMinor = expected;
        if (expectedCcy === currency && diff <= TOLERANCE_MINOR) { data.status = "MATCHED"; out.matched++; }
        else { data.status = "AMOUNT_MISMATCH"; data.note = expectedCcy !== currency ? `Currency ${currency} differs from the transfer's ${expectedCcy}` : `Differs from the booked amount by ${diff} minor units`; out.mismatched++; }
      } else { data.note = "No transfer with this reference"; out.unmatched++; }
    } else { data.note = "Not auto-matched: review manually"; out.unmatched++; }
    await db.reconLine.create({ data });
  }
  return out;
}

/** Completed payouts for a partner that no statement line accounts for. */
export async function missingFromStatements(partner: string, from: Date, to: Date) {
  const done = await db.transfer.findMany({ where: { status: "COMPLETED", completedAt: { gte: from, lte: to }, externalRef: { not: null } }, select: { id: true, externalRef: true, route: true, destAmount: true, destCurrency: true, completedAt: true }, take: 2000 });
  const mine = done.filter(t => JSON.stringify((t.route as { partners?: string[] }).partners ?? []).includes(partner));
  const refs = new Set((await db.reconLine.findMany({ where: { direction: "PAYOUT", transferId: { in: mine.map(t => t.id) } }, select: { transferId: true } })).map(r => r.transferId));
  return mine.filter(t => !refs.has(t.id)).map(t => ({ transferId: t.id, partnerRef: t.externalRef, amount: t.destAmount.toString(), currency: t.destCurrency, completedAt: t.completedAt }));
}
