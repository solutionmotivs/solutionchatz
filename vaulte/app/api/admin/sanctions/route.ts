// GET /api/admin/sanctions?status=OPEN|CLEARED|CONFIRMED — screening alerts + list freshness.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  const status = req.nextUrl.searchParams.get("status") ?? "OPEN";
  if (!["OPEN", "CLEARED", "CONFIRMED"].includes(status)) return apiError("VALIDATION_ERROR", "Unknown status", 400, "status");
  const [alerts, lists] = await Promise.all([
    db.screeningCheck.findMany({ where: { status }, orderBy: { createdAt: "asc" }, take: 100 }),
    db.sanctionsList.findMany({ orderBy: { code: "asc" } }),
  ]);
  const orgs = await db.organization.findMany({ where: { id: { in: alerts.map(a => a.organizationId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const orgName = new Map(orgs.map(o => [o.id, o.name]));
  return apiSuccess({
    lists: lists.map(l => ({ code: l.code, version: l.version, entries: l.entryCount, addresses: l.addressCount, fetched_at: l.fetchedAt, status: l.status, error: l.error })),
    data: alerts.map(a => ({
      id: a.id, created_at: a.createdAt, organization: a.organizationId ? orgName.get(a.organizationId) ?? a.organizationId : null, subject_type: a.subjectType, subject_id: a.subjectId,
      query: a.query, result: a.result, top_score: a.topScore, matches: a.matches, status: a.status, note: a.note, decided_at: a.decidedAt,
    })),
  });
}
