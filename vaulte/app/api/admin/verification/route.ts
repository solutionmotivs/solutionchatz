// GET /api/admin/verification?status=IN_REVIEW — staff review queue.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";

const STATUSES = ["DRAFT", "SUBMITTED", "IN_REVIEW", "NEEDS_INFO", "APPROVED", "REJECTED"] as const;

export async function GET(req: NextRequest) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  const status = req.nextUrl.searchParams.get("status") ?? "IN_REVIEW";
  const dueSoon = status === "DUE_REVIEW";
  if (!dueSoon && !STATUSES.includes(status as typeof STATUSES[number])) return apiError("VALIDATION_ERROR", "Unknown status", 400, "status");
  const cases = await db.verificationCase.findMany({
    where: dueSoon
      ? { status: "APPROVED", nextReviewAt: { lte: new Date(Date.now() + 30 * 86400000) } }
      : { status: status as typeof STATUSES[number] },
    orderBy: dueSoon ? { nextReviewAt: "asc" } : { submittedAt: "asc" },
    take: 100,
    include: { organization: { select: { name: true, country: true } }, entity: { select: { legalName: true } } },
  });
  return apiSuccess({
    data: cases.map(c => ({
      id: c.id, kind: c.kind, subject_type: c.subjectType, organization: c.organization.name,
      subject_name: c.entity?.legalName ?? ((c.profile as Record<string, any>)?.legal_name ?? c.organization.name),
      country: c.country, purposes: c.purposes, tier: c.tier, risk_score: c.riskScore,
      blocked: !!(c.screening as { blocked?: boolean } | null)?.blocked, status: c.status,
      submitted_at: c.submittedAt, next_review_at: c.nextReviewAt, approvals: (c.approvals as unknown[]).length,
    })),
  });
}
