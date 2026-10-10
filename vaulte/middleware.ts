// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken, TOKEN_COOKIE } from "@/lib/jwt";

const PUBLIC_PATHS = ["/", "/login", "/register", "/forgot-password", "/accept-invite", "/api/auth/login", "/api/auth/register"];
const API_PATHS = ["/api/payments", "/api/invoices", "/api/fx", "/api/webhooks"];

/** Cookie-authenticated, state-changing API calls must come from our own origin (defence in depth: handlers also check). */
function crossSiteMutation(req: NextRequest): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return false;
  if (!req.nextUrl.pathname.startsWith("/api/")) return false;
  if (!req.cookies.get(TOKEN_COOKIE) || req.headers.get("authorization")) return false; // API-key / bearer calls are not ambient-credential requests
  const origin = req.headers.get("origin");
  if (!origin) return false; // non-browser clients send no Origin
  try {
    const allowed = new Set<string>([req.nextUrl.host]);
    const host = req.headers.get("host"); if (host) allowed.add(host);
    if (process.env.NEXT_PUBLIC_APP_URL) allowed.add(new URL(process.env.NEXT_PUBLIC_APP_URL).host);
    return !allowed.has(new URL(origin).host);
  } catch { return true; }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();

  if (crossSiteMutation(req)) {
    return NextResponse.json({ error: { code: "CSRF_BLOCKED", message: "Cross-site request blocked" } }, { status: 403, headers: { "x-request-id": requestId } });
  }
  const res = await handle(req, pathname);
  res.headers.set("x-request-id", requestId);
  return res;
}

async function handle(req: NextRequest, pathname: string): Promise<NextResponse> {

  // Allow public paths
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + "?"))) {
    return NextResponse.next();
  }

  // API routes: use Authorization header (handled in route handlers)
  if (API_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Dashboard & other protected routes: check cookie
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/onboarding") || pathname.startsWith("/admin")) {
    const token = req.cookies.get(TOKEN_COOKIE)?.value;

    if (!token) {
      return NextResponse.redirect(new URL("/login", req.url));
    }

    const payload = await verifyToken(token);
    if (!payload) {
      const response = NextResponse.redirect(new URL("/login", req.url));
      response.cookies.delete(TOKEN_COOKIE);
      return response;
    }

    // Add user info to headers for server components
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-user-id", payload.sub);
    requestHeaders.set("x-org-id", payload.org);
    requestHeaders.set("x-user-role", payload.role);

    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|public/).*)",
  ],
};
