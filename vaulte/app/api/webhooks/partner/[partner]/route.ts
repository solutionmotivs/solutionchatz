// POST /api/webhooks/partner/:partner — events from licensed partners (deposits, payouts, account credits).
import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/utils";
import { getPartnerForWebhook } from "@/lib/psp/stablecoin/registry";
import { processPartnerEvent, ServiceError } from "@/lib/stablecoin/service";
import { handleServiceError } from "@/lib/api-helpers";

const EventSchema = z.object({ id: z.string().min(1).max(200), type: z.string().min(1).max(100), data: z.record(z.unknown()) });

export async function POST(req: NextRequest, { params }: { params: { partner: string } }) {
  const partner = getPartnerForWebhook(params.partner);
  if (!partner) return apiError("NOT_FOUND", "Unknown partner", 404);
  const raw = await req.text();
  if (raw.length > 256_000) return apiError("PAYLOAD_TOO_LARGE", "Payload too large", 413);
  let valid = false;
  try {
    valid = partner.verifyWebhook(raw, req.headers);
  } catch {
    valid = false;
  }
  if (!valid) return apiError("INVALID_SIGNATURE", "Signature verification failed", 401);
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return apiError("INVALID_JSON", "Body must be JSON", 400); }
  const parsed = EventSchema.safeParse(json);
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.errors[0].message, 400);
  try {
    const result = await processPartnerEvent(params.partner, parsed.data);
    return apiSuccess({ status: result });
  } catch (e) {
    if (e instanceof ServiceError) return handleServiceError(e);
    console.error("partner event failed", e);
    return apiError("PROCESSING_ERROR", "Event could not be processed; please retry", 500);
  }
}
