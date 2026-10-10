// POST /api/webhooks/inbound-email — signed JSON from your mail forwarder: {message_id, from, subject, text, attachments:[{filename, content_base64}]}.
// Header: x-inbound-signature: sha256=<hex HMAC-SHA256 of the raw body with INBOUND_EMAIL_SECRET>. Only allow-listed senders are accepted.
import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/utils";
import { processInbound, verifySignature } from "@/lib/documents/inbound-email";
import { clientIp, rateLimit } from "@/lib/security/ratelimit";

const Schema = z.object({
  message_id: z.string().min(3).max(300), from: z.string().min(3).max(300), subject: z.string().max(500).default(""), text: z.string().max(50_000).optional(),
  attachments: z.array(z.object({ filename: z.string().max(200), content_type: z.string().optional(), content_base64: z.string().max(12_000_000) })).max(10).optional(),
});

export async function POST(req: NextRequest) {
  if (!rateLimit(`inbound:${clientIp(req)}`, 60, 60_000)) return apiError("RATE_LIMITED", "Too many requests", 429);
  const raw = await req.text();
  if (raw.length > 25_000_000) return apiError("PAYLOAD_TOO_LARGE", "Message too large", 413);
  if (!verifySignature(raw, req.headers.get("x-inbound-signature"))) return apiError("UNAUTHORIZED", "Bad or missing signature", 401);
  let json: unknown; try { json = JSON.parse(raw); } catch { return apiError("INVALID_JSON", "Body must be JSON", 400); }
  const p = Schema.safeParse(json);
  if (!p.success) return apiError("VALIDATION_ERROR", p.error.errors[0].message, 400, p.error.errors[0].path.join("."));
  const r = await processInbound(p.data);
  return apiSuccess({ status: r.status, transfer_id: r.transferId ?? null, document_ids: r.documents, note: r.note ?? null });
}
