// Outbound webhooks to customers: signed (HMAC-SHA256), retried with backoff, SSRF-guarded.
import { createHmac } from "crypto";
import { db } from "@/lib/db";
import { assertPublicUrl } from "@/lib/security/ssrf";
import type { Prisma, WebhookEventType } from "@prisma/client";

/** attempt n (0-based) waits RETRY_DELAYS_SEC[n] after attempt n fails. 5 attempts in total. */
export const RETRY_DELAYS_SEC = [30, 300, 1800, 7200];
export const MAX_ATTEMPTS = RETRY_DELAYS_SEC.length + 1;

/** "payment.settled" -> PAYMENT_SETTLED */
export function toEventEnum(name: string): WebhookEventType {
  return name.replace(".", "_").toUpperCase() as WebhookEventType;
}

export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Queue an event for every active endpoint of the organization that subscribed to it. */
export async function emitWebhookEvent(opts: {
  organizationId: string;
  event: string; // dotted, e.g. "transfer.completed"
  data: Record<string, unknown>;
  paymentId?: string;
}): Promise<number> {
  const endpoints = await db.webhookEndpoint.findMany({
    where: { organizationId: opts.organizationId, isActive: true, events: { has: opts.event } },
  });
  if (!endpoints.length) return 0;
  const payload = { id: undefined as unknown as string, type: opts.event, created: new Date().toISOString(), data: opts.data };
  await db.webhookEvent.createMany({
    data: endpoints.map(e => ({
      endpointId: e.id,
      eventType: toEventEnum(opts.event),
      payload: payload as unknown as Prisma.InputJsonValue,
      paymentId: opts.paymentId ?? null,
      nextAttemptAt: new Date(),
    })),
  });
  return endpoints.length;
}

async function deliverOne(eventId: string): Promise<boolean> {
  const ev = await db.webhookEvent.findUnique({ where: { id: eventId }, include: { endpoint: true } });
  if (!ev || ev.delivered) return true;
  const attempts = ev.attempts + 1;
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ ...(ev.payload as object), id: ev.id });
  let ok = false;
  let error: string | null = null;
  try {
    await assertPublicUrl(ev.endpoint.url);
    const res = await fetch(ev.endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Vaulte-Signature": `t=${timestamp},v1=${signPayload(ev.endpoint.secret, timestamp, body)}`,
        "X-Vaulte-Event-Id": ev.id,
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    ok = res.status >= 200 && res.status < 300;
    if (!ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = e instanceof Error ? e.message : "delivery failed";
  }
  const delay = RETRY_DELAYS_SEC[attempts - 1];
  await db.webhookEvent.update({
    where: { id: ev.id },
    data: {
      attempts,
      delivered: ok,
      deliveredAt: ok ? new Date() : null,
      lastError: ok ? null : error,
      nextAttemptAt: ok || delay === undefined ? null : new Date(Date.now() + delay * 1000),
    },
  });
  await db.webhookEndpoint.update({
    where: { id: ev.endpointId },
    data: { lastAttemptAt: new Date(), failureCount: ok ? 0 : { increment: 1 } },
  });
  return ok;
}

/** Deliver everything that is due. Call from a cron (e.g. every minute) and right after emit. */
export async function processDueWebhooks(limit = 50): Promise<{ attempted: number; delivered: number }> {
  const due = await db.webhookEvent.findMany({
    where: { delivered: false, attempts: { lt: MAX_ATTEMPTS }, nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let delivered = 0;
  for (const d of due) if (await deliverOne(d.id)) delivered++;
  return { attempted: due.length, delivered };
}
