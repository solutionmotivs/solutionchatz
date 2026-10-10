// GET /api/exports/vouchers?from=&to=&format=csv|json&perspective=AUTO|PAYMENT|RECEIPT — one balanced accounting voucher per completed transfer,
// in your own books' terms (bank / counterparty / charges). Use this for any ERP that can import journals.
import { NextRequest } from "next/server";
import { apiSuccess } from "@/lib/utils";
import { integrationContext } from "@/lib/erp/api";
import { transfersForVouchers } from "@/lib/erp/sync";
import { buildVoucher, money, perspectiveFor, voucherBalanced, type Perspective } from "@/lib/erp/vouchers";
import { toCsv } from "@/lib/ledger/reports";

export async function GET(req: NextRequest) {
  const c = await integrationContext(req);
  if (c.response) return c.response;
  const q = req.nextUrl.searchParams;
  const { org, items } = await transfersForVouchers(c.orgId, { since: q.get("from") ? new Date(q.get("from")!) : undefined, until: q.get("to") ? new Date(q.get("to")!) : undefined, limit: 2000 });
  const forced = (q.get("perspective") ?? "AUTO") as Perspective | "AUTO";
  const vouchers = items.map(i => buildVoucher(i.data, perspectiveFor(i.data, org?.country ?? null, forced))).filter(voucherBalanced);
  if (q.get("format") === "csv") {
    const rows = vouchers.flatMap(v => v.lines.map(l => [v.date.toISOString().slice(0, 10), v.id, v.type, v.party, v.reference, v.currency, l.role, l.side, money(l.amountMinor, v.currency), v.narration]));
    return new Response(toCsv(["date", "voucher_id", "type", "party", "reference", "currency", "role", "side", "amount", "narration"], rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="vouchers.csv"', "Cache-Control": "private, no-store" } });
  }
  return apiSuccess({ data: vouchers.map(v => ({ ...v, date: v.date.toISOString(), lines: v.lines.map(l => ({ role: l.role, side: l.side, amount_minor: l.amountMinor.toString(), amount: money(l.amountMinor, v.currency) })) })) });
}
