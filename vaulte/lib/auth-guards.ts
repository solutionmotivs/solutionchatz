// Request guards for cookie-authenticated API routes (dashboard users and staff).
import type { UserRole } from "@prisma/client";
import { getAuthUser } from "@/lib/auth";
import { apiError } from "@/lib/utils";
import type { AuthUser } from "@/types";

type Guard = { user: AuthUser; response?: undefined } | { user?: undefined; response: Response };

/** Browsers always send Origin on cross-site POSTs; reject mismatches. Non-browser clients send no Origin. */
export function sameOriginOk(req: Request): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const o = new URL(origin);
    const allowed = new Set<string>([new URL(req.url).host]);
    const host = req.headers.get("host");
    if (host) allowed.add(host);
    if (process.env.NEXT_PUBLIC_APP_URL) allowed.add(new URL(process.env.NEXT_PUBLIC_APP_URL).host);
    return allowed.has(o.host);
  } catch {
    return false;
  }
}

export async function requireUser(req: Request, opts: { roles?: UserRole[] } = {}): Promise<Guard> {
  if (!sameOriginOk(req)) return { response: apiError("CSRF_BLOCKED", "Cross-site request blocked", 403) };
  const user = await getAuthUser();
  if (!user) return { response: apiError("UNAUTHORIZED", "Not authenticated", 401) };
  if (opts.roles && !opts.roles.includes(user.role as UserRole)) {
    return { response: apiError("FORBIDDEN", "Your role does not allow this action", 403) };
  }
  return { user };
}

/** Staff must be signed in with two-factor authentication enabled. */
export async function requireStaff(req: Request): Promise<Guard> {
  const g = await requireUser(req);
  if (g.response) return g;
  if (!g.user.isStaff) return { response: apiError("FORBIDDEN", "Staff access required", 403) };
  if (!g.user.totpEnabled) return { response: apiError("MFA_REQUIRED", "Enable two-factor authentication to use staff tools", 403) };
  return g;
}

/** Direct status overrides skip the KYC/KYB review. Allowed outside production; in production only if explicitly enabled. */
export function manualOverrideAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_MANUAL_VERIFY_OVERRIDE === "true";
}
