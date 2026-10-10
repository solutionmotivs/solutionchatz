import { NextRequest } from "next/server";
import { apiSuccess } from "@/lib/utils";
import { getAuthUser } from "@/lib/auth";
import { clearSessionCookie, revokeSession } from "@/lib/session";
import { sameOriginOk } from "@/lib/auth-guards";
import { apiError } from "@/lib/utils";

export async function POST(req: NextRequest) {
  if (!sameOriginOk(req)) return apiError("CSRF_BLOCKED", "Cross-site request blocked", 403);
  const user = await getAuthUser();
  if (user) await revokeSession(user.sessionId);
  clearSessionCookie();
  return apiSuccess({ status: "ok" });
}
