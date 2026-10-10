// GET /api/admin/escrow/disputes — milestones in dispute, oldest first.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiSuccess } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const g = await requireStaff(req);
  if (g.response) return g.response;
  const rows = await db.escrowMilestone.findMany({ where: { status: "DISPUTED" }, include: { deal: true }, orderBy: { disputeOpenedAt: "asc" }, take: 200 });
  const orgs = await db.organization.findMany({ where: { id: { in: Array.from(new Set(rows.map(r => r.deal.organizationId))) } }, select: { id: true, name: true } });
  const nm = new Map(orgs.map(o => [o.id, o.name]));
  return apiSuccess({ data: rows.map(m => ({ milestone_id: m.id, deal_id: m.dealId, deal: m.deal.title, mode: m.deal.mode, seller: nm.get(m.deal.organizationId), buyer: m.deal.buyerName, seq: m.seq, title: m.title, amount: Number(m.amount), currency: m.deal.currency, status: m.status, opened_by: m.disputeOpenedBy, opened_at: m.disputeOpenedAt?.toISOString(), reason: m.disputeReason, submission_note: m.submissionNote })) });
}
