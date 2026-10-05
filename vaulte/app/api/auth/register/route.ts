// app/api/auth/register/route.ts
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { signToken, TOKEN_COOKIE, TOKEN_TTL_SECONDS } from "@/lib/auth";
import { apiError, apiSuccess, sanitizeSlug } from "@/lib/utils";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { sendEmail } from "@/lib/email/sender";
import { welcomeEmail } from "@/lib/email/templates";

const RegisterSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(10).max(128),
  company_name: z.string().min(2).max(200),
  country: z.string().length(2).toUpperCase(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch {
    return apiError("INVALID_JSON", "Invalid JSON", 400);
  }

  const parsed = RegisterSchema.safeParse(body);
  if (!parsed.success) {
    const e = parsed.error.errors[0];
    return apiError("VALIDATION_ERROR", e.message, 400, e.path.join("."));
  }

  const { name, email, password, company_name, country } = parsed.data;

  const existing = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) return apiError("EMAIL_TAKEN", "An account with this email already exists", 409);

  const passwordHash = await bcrypt.hash(password, 12);

  // Unique slug
  let slug = sanitizeSlug(company_name);
  const slugExists = await db.organization.findUnique({ where: { slug } });
  if (slugExists) slug = `${slug}-${Date.now().toString(36)}`;

  // Create org
  const org = await db.organization.create({
    data: {
      name: company_name,
      slug,
      country,
      kybStatus: "NOT_STARTED",
      planId: "FREE",
      sandboxEnabled: true,
      onboardingStep: "COMPANY_DETAILS",
    },
  });

  // Create user
  const user = await db.user.create({
    data: {
      name,
      email: email.toLowerCase(),
      passwordHash,
      role: "OWNER",
      organizationId: org.id,
    },
  });

  // Auto test API key
  const { randomBytes } = await import("crypto");
  const rawKey = `vlt_test_${randomBytes(24).toString("hex")}`;
  const keyHash = await bcrypt.hash(rawKey, 10);
  await db.apiKey.create({
    data: {
      name: "Default Test Key",
      keyHash,
      keyPrefix: rawKey.slice(0, 16),
      isLive: false,
      scopes: [
        "payments:read", "payments:write",
        "invoices:read", "invoices:write",
        "kyb:write", "fx:read",
        "webhooks:write", "entities:read",
      ],
      organizationId: org.id,
    },
  });

  // JWT + cookie
  const token = await signToken({ sub: user.id, org: org.id, role: user.role });
  cookies().set(TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: TOKEN_TTL_SECONDS,
    path: "/",
  });

  // Audit log
  await db.auditLog.create({
    data: {
      action: "org.created",
      resourceType: "Organization",
      resourceId: org.id,
      organizationId: org.id,
      userId: user.id,
      metadata: { company_name, country },
    },
  });

  // ── WELCOME EMAIL ──────────────────────────────────────────────────────────
  // Fire-and-forget — don't await so it doesn't block the response
  sendEmail({
    to: email.toLowerCase(),
    template: welcomeEmail(name, company_name, rawKey),
    organizationId: org.id,
  }).catch(err => console.error("Welcome email failed:", err));

  return apiSuccess({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    organization: { id: org.id, name: org.name, slug: org.slug, kyb_status: org.kybStatus },
    test_api_key: rawKey,
    next_step: "/onboarding",
    message: "Account created. Redirecting to setup...",
  }, 201);
}
