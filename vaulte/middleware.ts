// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken, TOKEN_COOKIE } from "@/lib/jwt";

const PUBLIC_PATHS = ["/", "/login", "/register", "/forgot-password", "/accept-invite", "/api/auth/login", "/api/auth/register"];
const API_PATHS = ["/api/payments", "/api/invoices", "/api/fx", "/api/webhooks"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

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
