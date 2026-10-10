// Server-side sessions: a row per sign-in (revocable), referenced by a signed cookie.
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { TOKEN_COOKIE, TOKEN_TTL_SECONDS, signSessionToken } from "@/lib/jwt";

export const STAFF_SESSION_SECONDS = 8 * 60 * 60;

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}

export function deviceLabel(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /curl|node|python|axios|undici/i.test(ua) ? "API client" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export async function startSession(
  user: { id: string; organizationId: string; role: string; isStaff: boolean },
  req: Request,
  opts: { method: "PASSWORD" | "EMAIL_OTP" | "INVITE" | "SIGNUP"; mfa: boolean },
) {
  const ttl = user.isStaff ? STAFF_SESSION_SECONDS : TOKEN_TTL_SECONDS;
  const ua = req.headers.get("user-agent");
  const session = await db.session.create({
    data: {
      userId: user.id, expiresAt: new Date(Date.now() + ttl * 1000), userAgent: ua, ipAddress: clientIp(req),
      method: opts.method, mfa: opts.mfa, lastSeenAt: new Date(),
    },
  });
  const token = await signSessionToken({ sub: user.id, org: user.organizationId, role: user.role, sid: session.id }, ttl);
  cookies().set(TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: ttl,
    path: "/",
  });
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return session;
}

export function clearSessionCookie() {
  cookies().set(TOKEN_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 0, path: "/" });
}

export async function revokeSession(sessionId: string) {
  await db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await db.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}
