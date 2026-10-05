import { NextRequest } from "next/server";
import { apiSuccess } from "@/lib/utils";
import { loadCase, presentCase, submitCase } from "@/lib/kyc/service";
import { customerCase, handleError } from "@/lib/kyc/api";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await customerCase(req, params.id, { edit: true });
  if (r.response) return r.response;
  try {
    const out = await submitCase(r.c, r.user.id);
    return apiSuccess({ result: out, case: presentCase((await loadCase(r.c.id))!) }, 202);
  } catch (e) { return handleError(e); }
}
