// PUT /api/verification/:id/items/:code — save an identifier (PAN, GSTIN, bank account, ...); verified immediately when a provider supports it.
import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/utils";
import { hit } from "@/lib/security/ratelimit-db";
import { loadCase, presentCase, setItem } from "@/lib/kyc/service";
import { customerCase, handleError, parseJson } from "@/lib/kyc/api";

const Body = z.object({ value: z.string().min(3).max(120) });

export async function PUT(req: NextRequest, { params }: { params: { id: string; code: string } }) {
  const r = await customerCase(req, params.id, { edit: true });
  if (r.response) return r.response;
  const p = await parseJson(req, Body);
  if (p.response) return p.response;
  // Provider lookups can be billable: cap them per organization.
  const lim = await hit(`kyc:item:${r.user.organizationId}`, 40, 3600);
  if (!lim.allowed) return apiError("RATE_LIMITED", "Too many identifier checks. Try again later.", 429);
  try {
    const result = await setItem(r.c, params.code.toUpperCase(), p.data.value);
    return apiSuccess({ result, case: presentCase((await loadCase(r.c.id))!) });
  } catch (e) { return handleError(e); }
}
