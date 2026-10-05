import { cookies } from "next/headers";
import { db } from "@/lib/db";
import type { AuthUser } from "@/types";
import { TOKEN_COOKIE, TOKEN_TTL_SECONDS, signSessionToken, verifyToken } from "@/lib/jwt";

export { TOKEN_COOKIE, TOKEN_TTL_SECONDS, signSessionToken, verifyToken };

const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * The signed-in user for the current browser request. The JWT only identifies a session; the session row is the
 * source of truth, so sessions can be revoked and suspended users are locked out immediately.
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  try {
    const token = cookies().get(TOKEN_COOKIE)?.value;
    if (!token) return null;
    const payload = await verifyToken(token);
    if (!payload?.sid) return null;

    const session = await db.session.findUnique({
      where: { id: payload.sid },
      include: { user: { include: { organization: { select: { name: true, kybStatus: true, accountType: true } } } } },
    });
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) return null;
    const user = session.user;
    if (user.id !== payload.sub || user.status !== "ACTIVE" || !user.emailVerifiedAt) return null;

    if (!session.lastSeenAt || Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      organizationName: user.organization.name,
      kybStatus: user.organization.kybStatus as AuthUser["kybStatus"],
      sessionId: session.id,
      isStaff: user.isStaff,
      emailVerified: true,
      totpEnabled: user.mfaEnabled,
      accountType: user.organization.accountType === "INDIVIDUAL" ? "INDIVIDUAL" : "BUSINESS",
    };
  } catch {
    return null;
  }
}

export async function requireAuth(): Promise<AuthUser> {
  const user = await getAuthUser();
  if (!user) {
    throw new Error("UNAUTHORIZED");
  }
  return user;
}

// API Key auth for developer API
export async function verifyApiKey(
  authHeader: string | null
): Promise<{ organizationId: string; scopes: string[] } | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;

  const rawKey = authHeader.slice(7);
  if (!rawKey) return null;

  // Keys are prefixed: vlt_live_XXXXXXXX or vlt_test_XXXXXXXX
  const prefix = rawKey.slice(0, 16);

  try {
    const apiKeys = await db.apiKey.findMany({
      where: { keyPrefix: prefix },
      select: {
        id: true,
        keyHash: true,
        organizationId: true,
        scopes: true,
        isLive: true,
      },
    });

    if (!apiKeys.length) return null;

    const bcrypt = await import("bcryptjs");

    for (const apiKey of apiKeys) {
      const match = await bcrypt.compare(rawKey, apiKey.keyHash);
      if (match) {
        // Update lastUsedAt
        await db.apiKey.update({
          where: { id: apiKey.id },
          data: { lastUsedAt: new Date() },
        });
        return {
          organizationId: apiKey.organizationId,
          scopes: apiKey.scopes,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}
