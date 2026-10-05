import { NextRequest } from "next/server";
import { apiSuccess } from "@/lib/utils";
import { loadCase, presentCase, removePerson } from "@/lib/kyc/service";
import { customerCase, handleError } from "@/lib/kyc/api";

export async function DELETE(req: NextRequest, { params }: { params: { id: string; pid: string } }) {
  const r = await customerCase(req, params.id, { edit: true });
  if (r.response) return r.response;
  try {
    await removePerson(r.c, params.pid);
    return apiSuccess(presentCase((await loadCase(r.c.id))!));
  } catch (e) { return handleError(e); }
}
