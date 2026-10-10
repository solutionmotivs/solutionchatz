import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";
import { loadCase, presentCase } from "@/lib/kyc/service";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  const c = await loadCase(params.id);
  if (!c) return apiError("NOT_FOUND", "Verification not found", 404);
  const org = await db.organization.findUnique({ where: { id: c.organizationId }, select: { name: true, country: true, accountType: true } });
  return apiSuccess({
    ...presentCase(c), organization: org, risk_score: c.riskScore, risk_factors: c.riskFactors, screening: c.screening,
    approvals: c.approvals, tiers_note: "EDD cases need two different approvers.",
  });
}
