import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import type { JWTPayload, AuthUser } from "@/types";

// Resolved lazily so `next build` works without env vars, but a production
// server refuses to sign or verify tokens without a real secret.
function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET must be set to at least 32 characters in production");
    }
    return new TextEncoder().encode("dev-only-secret-do-not-use-in-production-0000");
  }
  return new TextEncoder().encode(secret);
}

export const TOKEN_COOKIE = "vaulte_session";
export const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function signToken(payload: Omit<JWTPayload, "iat" | "exp">) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(getJwtSecret());
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

export async function getAuthUser(): Promise<AuthUser | null> {
  try {
    const cookieStore = cookies();
    const token = cookieStore.get(TOKEN_COOKIE)?.value;
    if (!token) return null;

    const payload = await verifyToken(token);
    if (!payload) return null;

    const user = await db.user.findUnique({
      where: { id: payload.sub },
      include: {
        organization: {
          select: { name: true, kybStatus: true },
        },
      },
    });

    if (!user) return null;

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      organizationName: user.organization.name,
      kybStatus: user.organization.kybStatus as AuthUser["kybStatus"],
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
