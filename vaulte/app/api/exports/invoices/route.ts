import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { apiSuccess } from "@/lib/utils";
import { integrationContext } from "@/lib/erp/api";
import { toCsv } from "@/lib/ledger/reports";
import { money } from "@/lib/erp/vouchers";

export async function GET(req: NextRequest) {
  const c = await integrationContext(req);
  if (c.response) return c.response;
  const q = req.nextUrl.searchParams;
  const rows = await db.invoice.findMany({ where: { organizationId: c.orgId, ...(q.get("from") ? { createdAt: { gte: new Date(q.get("from")!) } } : {}) }, orderBy: { createdAt: "asc" }, take: 5000 });
  const flat = rows.map(i => ({ id: i.id, number: i.number, status: i.status, currency: i.currency, subtotal: money(i.subtotal, i.currency), total: money(i.totalAmount, i.currency), purpose_code: (i as unknown as { purposeCode?: string | null }).purposeCode ?? "", created_at: i.createdAt.toISOString(), paid_at: i.paidAt?.toISOString() ?? "" }));
  if (q.get("format") === "csv") return new Response(toCsv(Object.keys(flat[0] ?? { id: "" }), flat.map(r => Object.values(r))), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="invoices.csv"', "Cache-Control": "private, no-store" } });
  return apiSuccess({ data: flat });
}
