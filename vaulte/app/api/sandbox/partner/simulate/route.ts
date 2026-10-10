// POST /api/sandbox/partner/simulate — plays the role of a partner in sandbox: funds arrive, payouts complete or fail.
// Goes through the SAME signed-webhook processing path as real partner events. Only affects sandbox transfers.
import { NextRequest } from "next/server";
import { z } from "zod";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { verifyApiKey } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { readJson } from "@/lib/api-helpers";
import { processPartnerEvent } from "@/lib/stablecoin/service";
import type { Route } from "@/lib/stablecoin/types";

const Schema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("deposit.confirmed"), transfer_id: z.string(), amount_micro: z.string().regex(/^\d+$/).optional(), from_address: z.string().optional() }),
  z.object({ event: z.literal("fiat.received"), transfer_id: z.string(), amount: z.number().int().positive().optional() }),
  z.object({ event: z.literal("payout.completed"), transfer_id: z.string(), efira_ref: z.string().optional() }),
  z.object({ event: z.literal("payout.failed"), transfer_id: z.string(), reason: z.string().optional() }),
  z.object({
    event: z.literal("virtual_account.credit"), virtual_account_id: z.string(), amount: z.number().int().positive(), currency: z.string().length(3).toUpperCase().optional(),
    sender_name: z.string().default("Sandbox Payer Ltd"), sender_country: z.string().length(2).default("US"), payer_verified: z.boolean().default(true),
  }),
]);

export async function POST(req: NextRequest) {
  const auth = await verifyApiKey(req.headers.get("authorization"));
  if (!auth) return apiError("UNAUTHORIZED", "Invalid or missing API key", 401);
  const body = await readJson(req);
  if (body === undefined) return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return apiError("VALIDATION_ERROR", parsed.error.errors[0].message, 400);
  const d = parsed.data;
  const eventId = `sim_${randomBytes(8).toString("hex")}`;

  if (d.event === "virtual_account.credit") {
    const va = await db.virtualAccount.findFirst({ where: { id: d.virtual_account_id, organizationId: auth.organizationId }, include: { entity: true } });
    if (!va) return apiError("NOT_FOUND", "Virtual account not found", 404);
    if (!va.entity.isSandbox) return apiError("NOT_SANDBOX", "Simulation only works for sandbox accounts", 403);
    const r = await processPartnerEvent(va.partner, {
      id: eventId, type: "virtual_account.credit",
      data: { partner_ref: va.partnerRef, amount: d.amount, currency: d.currency ?? va.currency, sender_name: d.sender_name, sender_country: d.sender_country, payer_verified: d.payer_verified, reference: eventId },
    });
    return apiSuccess({ simulated: d.event, result: r });
  }

  const t = await db.transfer.findFirst({ where: { id: d.transfer_id, organizationId: auth.organizationId }, include: { deposits: true } });
  if (!t) return apiError("NOT_FOUND", "Transfer not found", 404);
  if (!t.isSandbox) return apiError("NOT_SANDBOX", "Simulation only works for sandbox transfers", 403);
  const route = t.route as unknown as Route;
  const fundingPartner = route.legs[0].partner;
  const payoutPartner = route.legs[route.legs.length - 1].partner;

  let result: string;
  switch (d.event) {
    case "deposit.confirmed": {
      const dep = t.deposits[0];
      if (!dep) return apiError("INVALID_STATE", "Transfer has no deposit address yet", 409);
      result = await processPartnerEvent(fundingPartner, {
        id: eventId, type: "deposit.confirmed",
        data: { address: dep.address, tx_hash: `0x${randomBytes(16).toString("hex")}`, confirmations: 12, amount_micro: d.amount_micro ?? dep.expectedAmount.toString(), from_address: d.from_address },
      });
      break;
    }
    case "fiat.received":
      result = await processPartnerEvent(fundingPartner, { id: eventId, type: "fiat.received", data: { reference: t.id, amount: d.amount ?? Number(t.sourceAmount) } });
      break;
    case "payout.completed":
      result = await processPartnerEvent(payoutPartner, { id: eventId, type: "payout.completed", data: { transfer_id: t.id, efira_ref: d.efira_ref ?? (t.destCountry === "IN" ? `EFIRA-SBX-${randomBytes(4).toString("hex").toUpperCase()}` : null) } });
      break;
    case "payout.failed":
      result = await processPartnerEvent(payoutPartner, { id: eventId, type: "payout.failed", data: { transfer_id: t.id, reason: d.reason ?? "simulated partner failure" } });
      break;
  }
  const fresh = await db.transfer.findUnique({ where: { id: t.id }, select: { status: true, statusReason: true } });
  return apiSuccess({ simulated: d.event, result, transfer_status: fresh?.status, status_reason: fresh?.statusReason });
}
