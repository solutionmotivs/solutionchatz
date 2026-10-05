// API key management for signed-in users. Raw keys are shown once; only hashes are stored.
import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";
import { requireUser } from "@/lib/auth-guards";

const ALL_SCOPES = ["payments:read", "payments:write", "invoices:read", "invoices:write", "kyb:write", "fx:read", "webhooks:write", "entities:read"];
const Schema = z.object({ name: z.string().trim().min(2).max(60), live: z.boolean().default(false), scopes: z.array(z.enum(ALL_SCOPES as [string, ...string[]])).min(1).optional() });

export async function GET(req: NextRequest) {
  const g = await requireUser(req);
  if (g.response) return g.response;
  const keys = await db.apiKey.findMany({ where: { organizationId: g.user.organizationId }, orderBy: { createdAt: "desc" } });
  return apiSuccess({ data: keys.map(k => ({ id: k.id, name: k.name, prefix: k.keyPrefix, live: k.isLive, scopes: k.scopes, last_used_at: k.lastUsedAt?.toISOString() ?? null, created_at: k.createdAt.toISOString() })) });
}

export async function POST(req: NextRequest) {
  const g = await requireUser(req, { roles: ["OWNER", "ADMIN", "DEVELOPER"] });
  if (g.response) return g.response;
  let body: unknown;
  try { body = await req.json(); } catch { return apiError("INVALID_JSON", "Invalid JSON", 400); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.errors[0].message, 400);
  if (parsed.data.live && g.user.kybStatus !== "APPROVED") return apiError("VERIFICATION_REQUIRED", "Live API keys are available after verification is approved", 403);
  if ((await db.apiKey.count({ where: { organizationId: g.user.organizationId } })) >= 20) return apiError("LIMIT_EXCEEDED", "Maximum 20 API keys", 429);
  const raw = `vlt_${parsed.data.live ? "live" : "test"}_${randomBytes(24).toString("hex")}`;
  const key = await db.apiKey.create({
    data: { name: parsed.data.name, keyHash: await bcrypt.hash(raw, 10), keyPrefix: raw.slice(0, 16), isLive: parsed.data.live, scopes: parsed.data.scopes ?? ["payments:read", "payments:write", "invoices:read", "invoices:write", "fx:read", "entities:read"], organizationId: g.user.organizationId },
  });
  await db.auditLog.create({ data: { action: "apikey.created", resourceType: "ApiKey", resourceId: key.id, organizationId: g.user.organizationId, userId: g.user.id, metadata: { live: key.isLive } } });
  return apiSuccess({ id: key.id, name: key.name, key: raw, notice: "Store this key now. It is shown only once." }, 201);
}
