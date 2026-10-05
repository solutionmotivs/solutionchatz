import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess } from "@/lib/utils";
import { loadCase, presentCase, setProfile } from "@/lib/kyc/service";
import { customerCase, handleError, parseJson } from "@/lib/kyc/api";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await customerCase(req, params.id);
  if (r.response) return r.response;
  return apiSuccess(presentCase(r.c));
}

const Patch = z.object({ profile: z.record(z.union([z.string().max(500), z.number(), z.null()])) });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await customerCase(req, params.id, { edit: true });
  if (r.response) return r.response;
  const p = await parseJson(req, Patch);
  if (p.response) return p.response;
  try {
    await setProfile(r.c, p.data.profile);
    return apiSuccess(presentCase((await loadCase(r.c.id))!));
  } catch (e) { return handleError(e); }
}
