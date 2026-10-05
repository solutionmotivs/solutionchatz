// POST /api/profile/email/request — change email: password check, then a code to the NEW address.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { requireUser } from "@/lib/auth-guards";
import { verifyPassword } from "@/lib/security/password";
import { sendOtp } from "@/lib/auth-flows";
import { OtpError } from "@/lib/otp";

const Schema = z.object({ new_email: z.string().trim().email().max(254), password: z.string().min(1).max(128) });

export async function POST(req: NextRequest) {
  const g = await requireUser(req);
  if (g.response) return g.response;
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Invalid JSON", 400); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.errors[0].message, 400);
  const user = await db.user.findUniqueOrThrow({ where: { id: g.user.id } });
  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) return apiError("INVALID_CREDENTIALS", "Password is incorrect", 401);
  const newEmail = parsed.data.new_email.toLowerCase();
  if (newEmail === user.email) return apiError("VALIDATION_ERROR", "That is already your email", 400);
  let devCode: string | undefined;
  try {
    // If the address belongs to someone else we stay silent (no enumeration) and simply never deliver a valid code.
    const taken = await db.user.findUnique({ where: { email: newEmail } });
    if (!taken) devCode = (await sendOtp(req, { purpose: "EMAIL_CHANGE", email: newEmail, name: user.name, userId: user.id, payload: { userId: user.id } })).devCode;
  } catch (e) {
    if (e instanceof OtpError) return apiError(e.code, e.message, 429);
    throw e;
  }
  return apiSuccess({ status: "code_sent", message: "If the address can be used, we sent a code to it.", ...(devCode ? { dev_code: devCode } : {}) }, 202);
}
