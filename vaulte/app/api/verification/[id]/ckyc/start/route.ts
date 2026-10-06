// POST /api/verification/:id/ckyc/start {id_type, id_number, date_of_birth?} — look the person up in CKYC; an OTP goes to their registered mobile.
import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess } from "@/lib/utils";
import { ckycStart } from "@/lib/kyc/service";
import { customerCase, handleError, parseJson } from "@/lib/kyc/api";

const Schema = z.object({ id_type: z.enum(["PAN", "PASSPORT", "VOTER", "DL", "CKYC"]), id_number: z.string().min(4).max(30), date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await customerCase(req, params.id, { edit: true });
  if (r.response) return r.response;
  const p = await parseJson(req, Schema);
  if (p.response) return p.response;
  try {
    const out = await ckycStart(r.c, { idType: p.data.id_type, idNumber: p.data.id_number, dob: p.data.date_of_birth });
    return apiSuccess({ status: out.status, reference_id: out.referenceId ?? null, ckyc_masked: out.ckycMasked ?? null, reason: out.reason ?? null });
  } catch (e) { return handleError(e); }
}
