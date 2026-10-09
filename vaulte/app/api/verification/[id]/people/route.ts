import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess } from "@/lib/utils";
import { addPerson, loadCase, presentCase } from "@/lib/kyc/service";
import { customerCase, handleError, parseJson } from "@/lib/kyc/api";
import { ID_TYPES } from "@/lib/kyc/requirements";

const Body = z.object({
  role: z.enum(["APPLICANT", "UBO", "DIRECTOR", "SIGNATORY"]),
  full_name: z.string().min(2).max(120),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be YYYY-MM-DD").optional(),
  nationality: z.string().length(2).optional(),
  country_of_residence: z.string().length(2).optional(),
  ownership_pct: z.number().min(0).max(100).optional(),
  is_pep: z.boolean().optional(),
  pan: z.string().max(12).optional(),
  id_type: z.enum(ID_TYPES).optional(),
  contact: z.object({
    email: z.string().email().max(120).optional(),
    phone: z.string().regex(/^[0-9]{5,15}$/, "Phone digits only, without the country code").optional(),
    phone_country_code: z.string().regex(/^[0-9]{1,4}$/).optional(),
    address: z.object({ line1: z.string().min(2).max(100), line2: z.string().max(100).optional(), city: z.string().min(1).max(50), state: z.string().max(50).optional(), postcode: z.string().min(2).max(12), country: z.string().length(2) }).optional(),
  }).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await customerCase(req, params.id, { edit: true });
  if (r.response) return r.response;
  const p = await parseJson(req, Body);
  if (p.response) return p.response;
  try {
    await addPerson(r.c, p.data);
    return apiSuccess(presentCase((await loadCase(r.c.id))!), 201);
  } catch (e) { return handleError(e); }
}
