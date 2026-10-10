// GET /api/public/id/:handle — public, no account: who a Pay ID belongs to (verified name) and how to pay it. Rate limited; reveals nothing for unknown, disabled or unverified handles.
import { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/utils";
import { clientIp, rateLimit } from "@/lib/security/ratelimit";
import { resolvePayId } from "@/lib/pay-address-public";

export async function GET(req: NextRequest, { params }: { params: { handle: string } }) {
  if (!rateLimit(`payid:${clientIp(req)}`, 120, 3600_000)) return apiError("RATE_LIMITED", "Too many lookups. Try again later.", 429);
  const r = await resolvePayId(params.handle).catch(() => null);
  if (!r) return apiError("NOT_FOUND", "No active Pay ID with that name", 404);
  return apiSuccess({ ...r, address: `${r.handle}@vaulte`, verified_by: "Vaulte", note: "These are bank details issued by the licensed partner named in your payment instructions. Vaulte does not hold the money. Check the name before you pay." });
}
