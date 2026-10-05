// app/api/webhooks/route.ts
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { orgContext } from "@/lib/documents/api";
import { apiError, apiSuccess } from "@/lib/utils";
import { z } from "zod";
import { randomBytes } from "crypto";
import { validateWebhookUrlShape } from "@/lib/security/ssrf";
import { EVENT_NAMES } from "@/lib/events/catalogue";

const ALL_EVENTS = EVENT_NAMES;

const CreateWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1).refine(
    evts => evts.every(e => ALL_EVENTS.includes(e)),
    { message: "Invalid event type" }
  ),
  secret: z.string().min(16).optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await orgContext(req, { write: true });
  if (ctx.response) return ctx.response;
  const auth = { organizationId: ctx.orgId };

  let body: unknown;
  try { body = await req.json(); } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const parsed = CreateWebhookSchema.safeParse(body);
  if (!parsed.success) {
    const e = parsed.error.errors[0];
    return apiError("VALIDATION_ERROR", e.message, 400, e.path.join("."));
  }

  const shape = validateWebhookUrlShape(parsed.data.url);
  if (!shape.ok) return apiError("INVALID_WEBHOOK_URL", shape.reason ?? "Invalid webhook URL", 400, "url");

  const count = await db.webhookEndpoint.count({ where: { organizationId: auth.organizationId } });
  if (count >= 10) {
    return apiError("LIMIT_EXCEEDED", "Maximum 10 webhook endpoints per organization", 429);
  }

  const secret = parsed.data.secret ?? `whsec_${randomBytes(24).toString("hex")}`;

  const webhook = await db.webhookEndpoint.create({
    data: {
      url: parsed.data.url,
      events: parsed.data.events,
      secret,
      isActive: true,
      organizationId: auth.organizationId,
    },
  });

  return apiSuccess({
    id: webhook.id,
    url: webhook.url,
    events: webhook.events,
    secret,
    is_active: webhook.isActive,
    created_at: webhook.createdAt.toISOString(),
    note: "Store the secret securely — it will not be shown again.",
  }, 201);
}

export async function GET(req: NextRequest) {
  const ctx = await orgContext(req);
  if (ctx.response) return ctx.response;
  const auth = { organizationId: ctx.orgId };

  const webhooks = await db.webhookEndpoint.findMany({
    where: { organizationId: auth.organizationId },
    orderBy: { createdAt: "desc" },
  });

  return apiSuccess({
    data: webhooks.map(w => ({
      id: w.id,
      url: w.url,
      events: w.events,
      is_active: w.isActive,
      failure_count: w.failureCount,
      last_attempt_at: w.lastAttemptAt?.toISOString() ?? null,
      created_at: w.createdAt.toISOString(),
    })),
  });
}
