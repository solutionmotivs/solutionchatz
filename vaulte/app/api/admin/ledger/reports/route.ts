// GET /api/admin/ledger/reports?type=trial_balance|income_statement|balance_sheet|memo|general_ledger&format=json|csv
import { NextRequest } from "next/server";
import { requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";
import { balanceSheet, generalLedger, incomeStatement, major, memoSchedule, toCsv, trialBalance } from "@/lib/ledger/reports";

const bigintJson = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
const d = (v: string | null, fallback: Date) => { if (!v) return fallback; const x = new Date(v); return isNaN(x.getTime()) ? fallback : x; };

export async function GET(req: NextRequest) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  const q = req.nextUrl.searchParams;
  const type = q.get("type") ?? "trial_balance";
  const csv = q.get("format") === "csv";
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const asOf = d(q.get("as_of") ?? q.get("to"), now);
  const from = d(q.get("from"), monthStart);
  const out = (name: string, body: string) => new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "private, no-store" } });

  if (type === "trial_balance") {
    const tb = await trialBalance(asOf);
    if (csv) return out("trial-balance", toCsv(["account", "name", "type", "memo", "currency", "debit", "credit", "net", "usd_debit", "usd_credit", "usd_net"], tb.rows.map(r => [r.code, r.name, r.type, r.isMemo, r.currency, major(r.debit, r.currency), major(r.credit, r.currency), major(r.net, r.currency), major(r.baseDebit), major(r.baseCredit), major(r.baseNet)])));
    return apiSuccess(bigintJson(tb));
  }
  if (type === "income_statement") {
    const r = await incomeStatement(from, asOf);
    if (csv) return out("income-statement", toCsv(["section", "class", "account", "name", "usd"], [...r.revenue.flatMap(s => s.accounts.map(a => ["revenue", s.class, a.code, a.name, major(a.baseUsdCents)])), ...r.expenses.flatMap(s => s.accounts.map(a => ["expense", s.class, a.code, a.name, major(a.baseUsdCents)])), ["total", "", "", "net income", major(r.netIncome)]]));
    return apiSuccess(bigintJson(r));
  }
  if (type === "balance_sheet") {
    const r = await balanceSheet(asOf);
    if (csv) return out("balance-sheet", toCsv(["section", "class", "account", "name", "usd"], [...r.assets.flatMap(s => s.accounts.map(a => ["assets", s.class, a.code, a.name, major(a.baseUsdCents)])), ...r.liabilities.flatMap(s => s.accounts.map(a => ["liabilities", s.class, a.code, a.name, major(a.baseUsdCents)])), ...r.equity.flatMap(s => s.accounts.map(a => ["equity", s.class, a.code, a.name, major(a.baseUsdCents)])), ["equity", "EARNINGS", "", "current earnings", major(r.currentEarnings)]]));
    return apiSuccess(bigintJson(r));
  }
  if (type === "memo") return apiSuccess(bigintJson(await memoSchedule(asOf)));
  if (type === "general_ledger") {
    const code = q.get("account");
    if (!code) return apiError("VALIDATION_ERROR", "account is required", 400, "account");
    const gl = await generalLedger(code, from, asOf, q.get("organization_id") ?? undefined);
    if (!gl.account) return apiError("NOT_FOUND", "Unknown account", 404);
    if (csv) return out(`gl-${code}`, toCsv(["date", "journal", "kind", "transfer", "memo", "currency", "debit", "credit", "balance", "usd"], gl.rows.map(r => [r.date, r.journalSeq, r.kind, r.transferId ?? "", r.memo ?? "", r.currency, major(r.debit, r.currency), major(r.credit, r.currency), major(r.balance, r.currency), major(r.baseUsdCents)])));
    return apiSuccess(bigintJson(gl));
  }
  return apiError("VALIDATION_ERROR", "Unknown report type", 400, "type");
}
