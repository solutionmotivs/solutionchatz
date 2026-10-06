// POST /api/verification/:id/screen — run the provider AML/PEP check on everyone listed now (it also runs automatically on submit).
import { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/utils";
import { hit } from "@/lib/security/ratelimit-db";
import { loadCase, pepScreen, presentCase } from "@/lib/kyc/service";
import { customerCase, handleError } from "@/lib/kyc/api";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await customerCase(req, params.id, { edit: true });
  if (r.response) return r.response;
  const lim = await hit(`kyc:screen:${r.user.organizationId}`, 20, 3600);
  if (!lim.allowed) return apiError("RATE_LIMITED", "Too many checks; try again later", 429);
  try {
    const out = await pepScreen(r.c);
    return apiSuccess({ ...out, case: presentCase((await loadCase(r.c.id))!) });
  } catch (e) { return handleError(e); }
}
