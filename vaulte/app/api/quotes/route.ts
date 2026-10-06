// POST /api/quotes — firm, time-limited price + route for a transfer. Nothing is charged or moved.
import { NextRequest } from "next/server";
import { z } from "zod";
import { verifyApiKey } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { createQuote, serializeQuote } from "@/lib/stablecoin/service";
import { handleServiceError, readJson } from "@/lib/api-helpers";

const Schema = z.object({
  kind: z.enum(["BUSINESS", "PERSONAL"]),
  sender_entity_id: z.string(),
  recipient_entity_id: z.string(),
  source_currency: z.string().length(3).toUpperCase(),
  dest_currency: z.string().length(3).toUpperCase(),
  source_amount: z.number().int().positive(),
  funding_method: z.enum(["STABLECOIN", "FIAT_LOCAL"]),
  token: z.enum(["USDC", "USDT"]).optional(),
  prefer: z.enum(["cheapest", "fastest", "balanced", "same_day"]).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req.headers.get("authorization"));
  if (!auth) return apiError("UNAUTHORIZED", "Invalid or missing API key", 401);
  if (!auth.scopes.includes("payments:write")) return apiError("FORBIDDEN", "API key missing payments:write scope", 403);

  const body = await readJson(req);
  if (body === undefined) return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    const e = parsed.error.errors[0];
    return apiError("VALIDATION_ERROR", e.message, 400, e.path.join("."));
  }
  const d = parsed.data;
  try {
    const { row, built } = await createQuote(auth.organizationId, {
      kind: d.kind, senderEntityId: d.sender_entity_id, recipientEntityId: d.recipient_entity_id,
      sourceCurrency: d.source_currency, destCurrency: d.dest_currency, sourceAmount: d.source_amount,
      fundingMethod: d.funding_method, token: d.token, prefer: d.prefer,
    });
    return apiSuccess(serializeQuote(row, built), 201);
  } catch (e) {
    return handleServiceError(e);
  }
}
