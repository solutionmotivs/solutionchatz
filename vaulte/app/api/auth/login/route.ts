// app/api/auth/login/route.ts
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { signToken, TOKEN_COOKIE, TOKEN_TTL_SECONDS } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return apiError("INVALID_JSON", "Invalid JSON", 400);
  }

  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", "Email and password required", 400);
  }

  const { email, password } = parsed.data;

  const user = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { organization: { select: { name: true, kybStatus: true, slug: true } } },
  });

  if (!user) {
    // Timing-safe: still run bcrypt
    await bcrypt.compare(password, "$2b$12$invalid.hash.for.timing.safety.xxxxx");
    return apiError("INVALID_CREDENTIALS", "Incorrect email or password", 401);
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return apiError("INVALID_CREDENTIALS", "Incorrect email or password", 401);

  // Update lastLoginAt
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  // Create session record
  await db.session.create({
    data: {
      userId: user.id,
      expiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000),
      userAgent: req.headers.get("user-agent") ?? null,
      ipAddress: req.headers.get("x-forwarded-for") ?? null,
    },
  });

  const token = await signToken({
    sub: user.id,
    org: user.organizationId,
    role: user.role,
  });

  cookies().set(TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: TOKEN_TTL_SECONDS,
    path: "/",
  });

  return apiSuccess({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      organization: {
        id: user.organizationId,
        name: user.organization.name,
        slug: user.organization.slug,
        kyb_status: user.organization.kybStatus,
      },
    },
  });
}
