// GET /api/statements?from=&to=&format=json|csv — the signed-in customer's account statement (session or API key).
import { NextRequest } from "next/server";
import { getAuthUser, verifyApiKey } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { customerStatement, major, toCsv } from "@/lib/ledger/reports";

export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  const orgId = user?.organizationId ?? (await verifyApiKey(req.headers.get("authorization")))?.organizationId;
  if (!orgId) return apiError("UNAUTHORIZED", "Not authenticated", 401);
  const q = req.nextUrl.searchParams;
  const to = q.get("to") ? new Date(q.get("to")!) : new Date();
  const from = q.get("from") ? new Date(q.get("from")!) : new Date(to.getTime() - 31 * 86400000);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return apiError("VALIDATION_ERROR", "from/to must be dates", 400);
  const s = await customerStatement(orgId, from, to);
  if (q.get("format") === "csv") {
    return new Response(toCsv(["date", "reference", "description", "currency", "received", "paid_out_or_fees", "open_obligation_after", "transfer_status", "partner_ref"], s.lines.map(l => [l.date, l.reference ?? "", l.description, l.currency, major(l.received, l.currency), major(l.paid_out_or_fees, l.currency), major(l.open_obligation_after, l.currency), l.transfer_status ?? "", l.partner_ref ?? ""])), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="statement.csv"', "Cache-Control": "private, no-store" } });
  }
  return apiSuccess(JSON.parse(JSON.stringify({ ...s, note: "Customer funds are held by licensed partners; Vaulte does not hold them. This statement shows Vaulte's records of your transfers." }, (_k, v) => (typeof v === "bigint" ? v.toString() : v))));
}
