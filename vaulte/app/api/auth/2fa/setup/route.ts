// POST /api/auth/2fa/setup — start authenticator enrolment (requires the current password). Not active until confirmed.
import { NextRequest } from "next/server";
import { z } from "zod";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { requireUser } from "@/lib/auth-guards";
import { verifyPassword } from "@/lib/security/password";
import { encryptString } from "@/lib/security/crypto";
import { generateTotpSecret, otpauthUrl } from "@/lib/security/totp";
import { hit } from "@/lib/security/ratelimit-db";

const Schema = z.object({ password: z.string().min(1).max(128) });

export async function POST(req: NextRequest) {
  const g = await requireUser(req);
  if (g.response) return g.response;
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Invalid JSON", 400); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Password required", 400);
  if (!(await hit(`2fa:setup:${g.user.id}`, 5, 900)).allowed) return apiError("RATE_LIMITED", "Too many attempts", 429);
  const user = await db.user.findUniqueOrThrow({ where: { id: g.user.id } });
  if (user.mfaEnabled) return apiError("ALREADY_ENABLED", "Two-factor authentication is already enabled", 409);
  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) return apiError("INVALID_CREDENTIALS", "Password is incorrect", 401);
  const secret = generateTotpSecret();
  await db.user.update({ where: { id: user.id }, data: { mfaSecret: encryptString(secret), mfaEnabled: false } });
  const url = otpauthUrl(user.email, "Vaulte", secret);
  return apiSuccess({ secret, otpauth_url: url, qr_data_url: await QRCode.toDataURL(url, { margin: 1, width: 220 }) });
}
