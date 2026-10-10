// GET: recent journals (filter by kind/transfer). POST: staff manual journal.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";
import { parseJson } from "@/lib/kyc/api";
import { LedgerError } from "@/lib/ledger/gl";
import { postManualJournal } from "@/lib/ledger/manual";

const Body = z.object({
  memo: z.string().min(10).max(500), date: z.string().optional(), idempotency_key: z.string().max(100).optional(),
  lines: z.array(z.object({ account: z.string().regex(/^\d{4}$/), currency: z.string().length(3).toUpperCase(), side: z.enum(["DEBIT", "CREDIT"]), amount: z.string().regex(/^\d+(\.\d+)?$/), organization_id: z.string().optional() })).min(2).max(20),
});

export async function GET(req: NextRequest) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  const q = req.nextUrl.searchParams;
  const rows = await db.glJournal.findMany({
    where: { ...(q.get("kind") ? { kind: q.get("kind")! } : {}), ...(q.get("transfer_id") ? { transferId: q.get("transfer_id")! } : {}), ...(q.get("source") ? { source: q.get("source")! } : {}) },
    orderBy: { seq: "desc" }, take: Math.min(Number(q.get("limit") ?? 50), 200), include: { entries: { include: { account: { select: { code: true, name: true } } } } },
  });
  return apiSuccess({ data: rows.map(j => ({ id: j.id, seq: j.seq, date: j.entryDate, period: j.periodId, kind: j.kind, source: j.source, memo: j.memo, transfer_id: j.transferId, reversal_of: j.reversalOfId, hash: j.hash, lines: j.entries.map(e => ({ account: e.account.code, name: e.account.name, currency: e.currency, amount_minor: e.amountMinor.toString(), usd_cents: e.baseUsdCents.toString() })) })) });
}

export async function POST(req: NextRequest) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  const p = await parseJson(req, Body);
  if (p.response) return p.response;
  try {
    const j = await postManualJournal({ staffId: staff.user.id, memo: p.data.memo, date: p.data.date ? new Date(p.data.date) : undefined, idempotencyKey: p.data.idempotency_key, lines: p.data.lines.map(l => ({ account: l.account, currency: l.currency, side: l.side, amount: l.amount, organizationId: l.organization_id })) });
    return apiSuccess({ id: j.id, seq: j.seq, hash: j.hash }, 201);
  } catch (e) {
    if (e instanceof LedgerError) return apiError("LEDGER_REJECTED", e.message, 422);
    throw e;
  }
}
