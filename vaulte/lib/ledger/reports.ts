// Financial reports built from the journals. Amounts: minor units per currency; USD cents for the consolidated (base) view.
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { LedgerError, periodBounds, verifyChain } from "./gl";

type Row = { code: string; name: string; type: string; class: string; isMemo: boolean; currency: string; debit: bigint; credit: bigint; net: bigint; baseDebit: bigint; baseCredit: bigint; baseNet: bigint };

export interface TrialBalance {
  asOf: string;
  rows: Row[];
  totals: { baseDebit: bigint; baseCredit: bigint; balanced: boolean; byCurrency: Record<string, { debit: bigint; credit: bigint; balanced: boolean }> };
}

export async function trialBalance(asOf: Date = new Date(), opts: { from?: Date } = {}): Promise<TrialBalance> {
  const from = opts.from ?? new Date(0);
  const rows = await db.$queryRaw<Row[]>`
    SELECT a."code", a."name", a."type", a."class", a."isMemo", e."currency",
      COALESCE(SUM(CASE WHEN e."amountMinor" > 0 THEN e."amountMinor" ELSE 0 END), 0)::bigint AS debit,
      COALESCE(SUM(CASE WHEN e."amountMinor" < 0 THEN -e."amountMinor" ELSE 0 END), 0)::bigint AS credit,
      COALESCE(SUM(e."amountMinor"), 0)::bigint AS net,
      COALESCE(SUM(CASE WHEN e."baseUsdCents" > 0 THEN e."baseUsdCents" ELSE 0 END), 0)::bigint AS "baseDebit",
      COALESCE(SUM(CASE WHEN e."baseUsdCents" < 0 THEN -e."baseUsdCents" ELSE 0 END), 0)::bigint AS "baseCredit",
      COALESCE(SUM(e."baseUsdCents"), 0)::bigint AS "baseNet"
    FROM "GlEntry" e JOIN "GlJournal" j ON j."id" = e."journalId" JOIN "GlAccount" a ON a."id" = e."accountId"
    WHERE j."entryDate" <= ${asOf} AND j."entryDate" >= ${from}
    GROUP BY a."code", a."name", a."type", a."class", a."isMemo", e."currency"
    ORDER BY a."code", e."currency"`;
  const byCurrency: TrialBalance["totals"]["byCurrency"] = {};
  let baseDebit = 0n, baseCredit = 0n;
  for (const r of rows) {
    baseDebit += r.baseDebit; baseCredit += r.baseCredit;
    const c = (byCurrency[r.currency] ??= { debit: 0n, credit: 0n, balanced: true });
    c.debit += r.debit; c.credit += r.credit;
  }
  for (const c of Object.values(byCurrency)) c.balanced = c.debit === c.credit;
  return { asOf: asOf.toISOString(), rows, totals: { baseDebit, baseCredit, balanced: baseDebit === baseCredit && Object.values(byCurrency).every(c => c.balanced), byCurrency } };
}

interface Section { class: string; accounts: { code: string; name: string; baseUsdCents: bigint }[]; total: bigint }

function groupByClass(rows: Row[], sign: 1 | -1): Section[] {
  const byAcct = new Map<string, { code: string; name: string; class: string; v: bigint }>();
  for (const r of rows) {
    const k = r.code; const cur = byAcct.get(k) ?? { code: r.code, name: r.name, class: r.class, v: 0n };
    cur.v += r.baseNet * BigInt(sign); byAcct.set(k, cur);
  }
  const sections = new Map<string, Section>();
  for (const a of Array.from(byAcct.values())) {
    const s = sections.get(a.class) ?? { class: a.class, accounts: [], total: 0n };
    s.accounts.push({ code: a.code, name: a.name, baseUsdCents: a.v }); s.total += a.v; sections.set(a.class, s);
  }
  return Array.from(sections.values());
}

export async function incomeStatement(from: Date, to: Date) {
  const tb = await trialBalance(to, { from });
  const pl = tb.rows.filter(r => (r.type === "REVENUE" || r.type === "EXPENSE") && !r.isMemo);
  const revenue = groupByClass(pl.filter(r => r.type === "REVENUE"), -1);
  const expenses = groupByClass(pl.filter(r => r.type === "EXPENSE"), 1);
  const totalRevenue = revenue.reduce((s, x) => s + x.total, 0n);
  const totalExpenses = expenses.reduce((s, x) => s + x.total, 0n);
  return { from: from.toISOString(), to: to.toISOString(), currency: "USD", revenue, expenses, totalRevenue, totalExpenses, netIncome: totalRevenue - totalExpenses };
}

export async function balanceSheet(asOf: Date) {
  const tb = await trialBalance(asOf);
  const real = tb.rows.filter(r => !r.isMemo);
  const assets = groupByClass(real.filter(r => r.type === "ASSET"), 1);
  const liabilities = groupByClass(real.filter(r => r.type === "LIABILITY"), -1);
  const equityRows = groupByClass(real.filter(r => r.type === "EQUITY"), -1);
  const earnings = real.filter(r => r.type === "REVENUE").reduce((s, r) => s - r.baseNet, 0n) - real.filter(r => r.type === "EXPENSE").reduce((s, r) => s + r.baseNet, 0n);
  const totalAssets = assets.reduce((s, x) => s + x.total, 0n);
  const totalLiabilities = liabilities.reduce((s, x) => s + x.total, 0n);
  const totalEquity = equityRows.reduce((s, x) => s + x.total, 0n) + earnings;
  return { asOf: asOf.toISOString(), currency: "USD", assets, liabilities, equity: equityRows, currentEarnings: earnings, totalAssets, totalLiabilities, totalEquity, balanced: totalAssets === totalLiabilities + totalEquity };
}

/** Customer money held by partners: not Vaulte's balance sheet. */
export async function memoSchedule(asOf: Date) {
  const tb = await trialBalance(asOf);
  return { asOf: asOf.toISOString(), rows: tb.rows.filter(r => r.isMemo), note: "Memorandum accounts: customer funds held by licensed partners. Not Vaulte's assets or liabilities." };
}

export interface GlLineRow { date: string; journalSeq: number; journalId: string; kind: string; memo: string | null; transferId: string | null; currency: string; debit: bigint; credit: bigint; balance: bigint; baseUsdCents: bigint }

export async function generalLedger(code: string, from: Date, to: Date, organizationId?: string): Promise<{ account: { code: string; name: string; normalBalance: string } | null; opening: Record<string, bigint>; rows: GlLineRow[] }> {
  const acct = await db.glAccount.findUnique({ where: { code } });
  if (!acct) return { account: null, opening: {}, rows: [] };
  const orgFilter = organizationId ? { organizationId } : {};
  const open = await db.glEntry.groupBy({ by: ["currency"], where: { accountId: acct.id, journal: { entryDate: { lt: from } }, ...orgFilter }, _sum: { amountMinor: true } });
  const opening: Record<string, bigint> = Object.fromEntries(open.map(o => [o.currency, o._sum.amountMinor ?? 0n]));
  const entries = await db.glEntry.findMany({ where: { accountId: acct.id, journal: { entryDate: { gte: from, lte: to } }, ...orgFilter }, include: { journal: true }, orderBy: [{ journal: { seq: "asc" } }, { id: "asc" }], take: 5000 });
  const running = { ...opening };
  const rows = entries.map(e => {
    running[e.currency] = (running[e.currency] ?? 0n) + e.amountMinor;
    return { date: e.journal.entryDate.toISOString(), journalSeq: e.journal.seq, journalId: e.journalId, kind: e.journal.kind, memo: e.journal.memo, transferId: e.journal.transferId, currency: e.currency, debit: e.amountMinor > 0n ? e.amountMinor : 0n, credit: e.amountMinor < 0n ? -e.amountMinor : 0n, balance: running[e.currency], baseUsdCents: e.baseUsdCents };
  });
  return { account: { code: acct.code, name: acct.name, normalBalance: acct.normalBalance }, opening, rows };
}

/** What the customer sees: money in, fees, payouts against their transfers, with a running balance of open obligations. */
export async function customerStatement(organizationId: string, from: Date, to: Date) {
  const gl = await generalLedger("9200", from, to, organizationId);
  const transfers = await db.transfer.findMany({ where: { id: { in: Array.from(new Set(gl.rows.map(r => r.transferId).filter((x): x is string => !!x))) } }, select: { id: true, sourceCurrency: true, destCurrency: true, status: true, destAmount: true, externalRef: true } });
  const byId = new Map(transfers.map(t => [t.id, t]));
  return {
    organizationId, from: from.toISOString(), to: to.toISOString(),
    opening: Object.fromEntries(Object.entries(gl.opening).map(([c, v]) => [c, -v])),
    lines: gl.rows.map(r => ({
      date: r.date, reference: r.transferId, description: describeKind(r.kind), currency: r.currency,
      // credit to the obligation account = money received for the customer; debit = fees or payout leaving
      received: r.credit, paid_out_or_fees: r.debit, open_obligation_after: -r.balance,
      transfer_status: r.transferId ? byId.get(r.transferId)?.status ?? null : null, partner_ref: r.transferId ? byId.get(r.transferId)?.externalRef ?? null : null,
    })),
  };
}

function describeKind(k: string): string {
  return ({ MEMO_FUNDS_RECEIVED: "Funds received by partner", MEMO_FEES_TAKEN: "Fees deducted", MEMO_PAYOUT: "Payout to recipient", FAILURE_REVERSAL: "Transfer failed: amounts reversed" } as Record<string, string>)[k.replace(/^REVERSAL:/, "")] ?? k;
}

// ── Period close ─────────────────────────────────────────────────────────────────

export async function closePeriod(periodId: string, staffId: string) {
  const p = await db.glPeriod.findUnique({ where: { id: periodId } });
  if (!p) throw new LedgerError("Period not found");
  if (p.status === "CLOSED") throw new LedgerError("Period is already closed");
  if (p.endsOn.getTime() > Date.now()) throw new LedgerError("A period can only be closed after it has ended");
  const earlier = await db.glPeriod.count({ where: { startsOn: { lt: p.startsOn }, status: "OPEN" } });
  if (earlier) throw new LedgerError("Close earlier periods first");
  const chain = await verifyChain();
  if (!chain.ok) throw new LedgerError(`Ledger integrity check failed (${chain.reason}); fix before closing`);
  const tb = await trialBalance(p.endsOn);
  if (!tb.totals.balanced) throw new LedgerError("Trial balance does not balance; cannot close");
  const snapshot = JSON.parse(JSON.stringify(tb, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  const hash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  return db.glPeriod.update({ where: { id: periodId }, data: { status: "CLOSED", closedAt: new Date(), closedById: staffId, snapshot, snapshotHash: hash } });
}

export function periodRange(id: string) { return periodBounds(id); }

// ── CSV ──────────────────────────────────────────────────────────────────────────

const csvCell = (v: unknown) => { const s = typeof v === "bigint" ? v.toString() : String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (header: string[], rows: unknown[][]) => [header, ...rows].map(r => r.map(csvCell).join(",")).join("\n") + "\n";
export const major = (minor: bigint, ccy = "USD") => { const neg = minor < 0n; const a = neg ? -minor : minor; const dec = ["JPY", "KRW", "VND", "CLP"].includes(ccy) ? 0 : 2; if (dec === 0) return `${neg ? "-" : ""}${a}`; return `${neg ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`; };
