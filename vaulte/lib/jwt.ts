// Edge-safe JWT helpers (jose only). Session tokens and MFA step-up tokens use different audiences,
// so one can never be used as the other.
import { SignJWT, jwtVerify } from "jose";
import type { JWTPayload } from "@/types";

export const TOKEN_COOKIE = "vaulte_session";
export const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days (staff sessions are shorter, see lib/session.ts)
const AUD_SESSION = "vaulte:session";
const AUD_MFA = "vaulte:mfa";

// Resolved lazily so `next build` works without env vars, but a production server refuses a weak or missing secret.
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

export async function signSessionToken(payload: Omit<JWTPayload, "iat" | "exp">, ttlSeconds = TOKEN_TTL_SECONDS) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(AUD_SESSION)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(getJwtSecret());
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), { audience: AUD_SESSION });
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

export interface MfaTokenPayload {
  sub: string;
  method: "PASSWORD" | "EMAIL_OTP";
}

export async function signMfaToken(p: MfaTokenPayload): Promise<string> {
  return new SignJWT({ ...p })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(AUD_MFA)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(getJwtSecret());
}

export async function verifyMfaToken(token: string): Promise<MfaTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), { audience: AUD_MFA });
    return { sub: String(payload.sub), method: payload.method as MfaTokenPayload["method"] };
  } catch {
    return null;
  }
}
