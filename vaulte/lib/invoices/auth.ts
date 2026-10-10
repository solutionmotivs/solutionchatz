// Invoices are used from the dashboard (session) and from servers (API key): resolve the organisation either way.
import type { NextRequest } from "next/server";
import { getAuthUser, verifyApiKey } from "@/lib/auth";
import { sameOriginOk } from "@/lib/auth-guards";
import { apiError } from "@/lib/utils";

export type InvoiceAuth = { organizationId: string; userId?: string; via: "session" | "key"; response?: undefined } | { response: Response; organizationId?: undefined; userId?: undefined; via?: undefined };

const WRITE_ROLES = ["OWNER", "ADMIN", "FINANCE"];

export async function invoiceAuth(req: NextRequest, write: boolean): Promise<InvoiceAuth> {
  if (req.headers.get("authorization")?.startsWith("Bearer ")) {
    const k = await verifyApiKey(req.headers.get("authorization"));
    if (!k) return { response: apiError("UNAUTHORIZED", "Invalid or missing API key", 401) };
    if (!k.scopes.includes(write ? "payments:write" : "payments:read")) return { response: apiError("FORBIDDEN", `API key needs the ${write ? "payments:write" : "payments:read"} scope`, 403) };
    return { organizationId: k.organizationId, via: "key" };
  }
  if (write && !sameOriginOk(req)) return { response: apiError("CSRF_BLOCKED", "Cross-site request blocked", 403) };
  const u = await getAuthUser();
  if (!u) return { response: apiError("UNAUTHORIZED", "Not authenticated", 401) };
  if (write && !WRITE_ROLES.includes(u.role)) return { response: apiError("FORBIDDEN", "Your role does not allow this action", 403) };
  return { organizationId: u.organizationId, userId: u.id, via: "session" };
}
