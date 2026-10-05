// GET /api/admin/document-requests?status=REQUESTED — staff queue of certificate requests.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiSuccess } from "@/lib/utils";
import { presentRequest } from "@/lib/documents/requests";

export async function GET(req: NextRequest) {
  const g = await requireStaff(req);
  if (g.response) return g.response;
  const status = req.nextUrl.searchParams.get("status") ?? "REQUESTED";
  const rows = await db.documentRequest.findMany({ where: status === "OPEN" ? { status: { in: ["REQUESTED", "IN_PROGRESS"] } } : { status }, orderBy: { createdAt: "asc" }, take: 200 });
  const orgs = await db.organization.findMany({ where: { id: { in: Array.from(new Set(rows.map(r => r.organizationId))) } }, select: { id: true, name: true } });
  const name = new Map(orgs.map(o => [o.id, o.name]));
  const transfers = await db.transfer.findMany({ where: { id: { in: rows.map(r => r.transferId) } }, select: { id: true, externalRef: true, destCountry: true, purposeCode: true, destCurrency: true, destAmount: true } });
  const tm = new Map(transfers.map(t => [t.id, t]));
  return apiSuccess({ data: rows.map(r => ({ ...presentRequest(r), organization: name.get(r.organizationId) ?? r.organizationId, partner_ref: tm.get(r.transferId)?.externalRef ?? null, dest_country: tm.get(r.transferId)?.destCountry, purpose_code: tm.get(r.transferId)?.purposeCode ?? null, dest_amount: String(tm.get(r.transferId)?.destAmount ?? 0), dest_currency: tm.get(r.transferId)?.destCurrency })) });
}
