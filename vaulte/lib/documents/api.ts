import type { NextRequest } from "next/server";
import { getAuthUser, verifyApiKey } from "@/lib/auth";
import { sameOriginOk } from "@/lib/auth-guards";
import { apiError } from "@/lib/utils";
import { DocError } from "./service";

/** Customer-side auth: a dashboard session or an API key. Returns the organization and (for sessions) the user. */
export async function orgContext(req: NextRequest, opts: { write?: boolean } = {}): Promise<{ orgId: string; userId?: string; role?: string; response?: undefined } | { response: Response; orgId?: undefined; userId?: undefined; role?: undefined }> {
  const user = await getAuthUser();
  if (user) {
    if (opts.write && !sameOriginOk(req)) return { response: apiError("CSRF_BLOCKED", "Cross-site request blocked", 403) };
    if (opts.write && !["OWNER", "ADMIN", "FINANCE"].includes(user.role)) return { response: apiError("FORBIDDEN", "Your role cannot add documents", 403) };
    return { orgId: user.organizationId, userId: user.id, role: user.role };
  }
  const k = await verifyApiKey(req.headers.get("authorization"));
  if (k) return { orgId: k.organizationId };
  return { response: apiError("UNAUTHORIZED", "Not authenticated", 401) };
}

export const docErrorResponse = (e: unknown) => (e instanceof DocError ? apiError(e.code, e.message, e.status) : null);
