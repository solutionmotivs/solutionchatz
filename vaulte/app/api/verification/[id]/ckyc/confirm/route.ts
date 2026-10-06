// POST /api/verification/:id/ckyc/confirm {reference_id, otp, person_id?} — download the CKYC record with the holder's OTP.
import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess } from "@/lib/utils";
import { ckycConfirm, loadCase, presentCase } from "@/lib/kyc/service";
import { customerCase, handleError, parseJson } from "@/lib/kyc/api";

const Schema = z.object({ reference_id: z.string().min(3).max(120), otp: z.string().regex(/^\d{4,8}$/), person_id: z.string().optional() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await customerCase(req, params.id, { edit: true });
  if (r.response) return r.response;
  const p = await parseJson(req, Schema);
  if (p.response) return p.response;
  try {
    const out = await ckycConfirm(r.c, { referenceId: p.data.reference_id, otp: p.data.otp, personId: p.data.person_id });
    return apiSuccess({ ...out, case: presentCase((await loadCase(r.c.id))!) });
  } catch (e) { return handleError(e); }
}
