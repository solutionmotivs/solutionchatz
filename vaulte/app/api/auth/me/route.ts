import { NextRequest } from "next/server";
import { apiSuccess } from "@/lib/utils";
import { requireUser } from "@/lib/auth-guards";

export async function GET(req: NextRequest) {
  const g = await requireUser(req);
  if (g.response) return g.response;
  const u = g.user;
  return apiSuccess({
    id: u.id, name: u.name, email: u.email, role: u.role, is_staff: u.isStaff, mfa_enabled: u.totpEnabled,
    organization: { id: u.organizationId, name: u.organizationName, kyb_status: u.kybStatus, account_type: u.accountType },
  });
}
