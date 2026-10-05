// POST /api/auth/password/forgot — email a reset code. Always the same response.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { sendOtp } from "@/lib/auth-flows";
import { OtpError } from "@/lib/otp";

const Schema = z.object({ email: z.string().trim().email() });

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Invalid JSON", 400); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", "Enter a valid email", 400);
  const email = parsed.data.email.toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  let devCode: string | undefined;
  try {
    if (user && user.status === "ACTIVE") devCode = (await sendOtp(req, { purpose: "PASSWORD_RESET", email, name: user.name, userId: user.id })).devCode;
  } catch (e) {
    if (e instanceof OtpError) return apiError(e.code, e.message, 429);
    throw e;
  }
  return apiSuccess({ status: "ok", message: "If an account exists, we sent a reset code.", ...(devCode ? { dev_code: devCode } : {}) }, 202);
}
