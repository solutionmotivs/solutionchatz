// POST /api/webhooks/escrow/:agent — signed events from the licensed escrow agent: escrow.funded | escrow.released | escrow.refunded.
import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/utils";
import { getEscrowAgentForWebhook } from "@/lib/escrow/agent";
import { onAgentEvent } from "@/lib/escrow/service";

const Event = z.object({ id: z.string().min(1).max(200), type: z.enum(["escrow.funded", "escrow.released", "escrow.refunded"]), data: z.object({ agent_ref: z.string().min(1).max(200), milestone_ref: z.string().min(1).max(200) }) });

export async function POST(req: NextRequest, { params }: { params: { agent: string } }) {
  const agent = getEscrowAgentForWebhook(params.agent);
  if (!agent) return apiError("NOT_FOUND", "Unknown escrow agent", 404);
  const raw = await req.text();
  if (raw.length > 64_000) return apiError("PAYLOAD_TOO_LARGE", "Payload too large", 413);
  let ok = false; try { ok = agent.verifyWebhook(raw, req.headers); } catch { ok = false; }
  if (!ok) return apiError("INVALID_SIGNATURE", "Signature verification failed", 401);
  let json: unknown; try { json = JSON.parse(raw); } catch { return apiError("INVALID_JSON", "Body must be JSON", 400); }
  const norm = agent.normalizeWebhook ? agent.normalizeWebhook(json) : json;
  if (norm === null) return apiSuccess({ status: "ignored" });
  const p = Event.safeParse(norm);
  if (!p.success) return apiError("VALIDATION_ERROR", p.error.errors[0].message, 400);
  const handled = await onAgentEvent(p.data.type, p.data.data.agent_ref, p.data.data.milestone_ref);
  return apiSuccess({ status: handled ? "processed" : "ignored" });
}
