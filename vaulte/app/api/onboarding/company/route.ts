// app/api/onboarding/company/route.ts
import { NextRequest } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return apiError("UNAUTHORIZED", "Not authenticated", 401);

  const body = await req.json() as { legalName?: string; businessType?: string; website?: string };

  await db.organization.update({
    where: { id: user.organizationId },
    data: {
      legalName: body.legalName ?? undefined,
      businessType: body.businessType ?? undefined,
      website: body.website ?? undefined,
      onboardingStep: "ADD_ENTITY",
    },
  });

  return apiSuccess({ ok: true });
}
