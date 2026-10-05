// GET /api/exports/transfers?from=&to=&format=csv|json — your transfers for spreadsheets and BI.
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
  const rows = await db.transfer.findMany({
    where: { organizationId: c.orgId, ...(q.get("from") || q.get("to") ? { createdAt: { ...(q.get("from") ? { gte: new Date(q.get("from")!) } : {}), ...(q.get("to") ? { lte: new Date(q.get("to")!) } : {}) } } : {}) },
    orderBy: { createdAt: "asc" }, take: 5000, include: { sender: { select: { legalName: true } }, recipient: { select: { legalName: true } } },
  });
  const flat = rows.map(t => ({ id: t.id, created_at: t.createdAt.toISOString(), completed_at: t.completedAt?.toISOString() ?? "", status: t.status, kind: t.kind, sender: t.sender.legalName, sender_country: t.originCountry, recipient: t.recipient.legalName, recipient_country: t.destCountry, source_currency: t.sourceCurrency, source_amount: money(t.sourceAmount, t.sourceCurrency), dest_currency: t.destCurrency, dest_amount: money(t.destAmount, t.destCurrency), fees_usd: money(t.partnerCostUsd + t.markupUsd, "USD"), purpose_code: t.purposeCode ?? "", partner_reference: t.externalRef ?? "", efira_reference: t.efiraRef ?? "" }));
  if (q.get("format") === "csv") return new Response(toCsv(Object.keys(flat[0] ?? { id: "" }), flat.map(r => Object.values(r))), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="transfers.csv"', "Cache-Control": "private, no-store" } });
  return apiSuccess({ data: flat });
}
