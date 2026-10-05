// GET /api/events/catalogue — public documentation of every webhook event (names, descriptions, sample payloads, signing).
import { apiSuccess } from "@/lib/utils";
import { EVENTS } from "@/lib/events/catalogue";

export async function GET() {
  return apiSuccess({
    events: EVENTS,
    delivery: { method: "POST JSON", signature_header: "X-Vaulte-Signature: t=<unix seconds>,v1=<hex>", signature: "HMAC-SHA256(endpoint secret, `${t}.${raw body}`); reject if t is older than 5 minutes", idempotency: "Each delivery has a stable `id` (also X-Vaulte-Event-Id): treat repeats as duplicates", retries: "5 attempts: after 30 s, 5 min, 30 min, 2 h; then the event is dead-lettered and can be replayed from the dashboard or API" },
  });
}
