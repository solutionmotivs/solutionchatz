import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { verifyApiKey } from "@/lib/auth";
import { apiError, apiSuccess } from "@/lib/utils";
import { serializeTransfer } from "@/lib/stablecoin/service";
import { transferBalances } from "@/lib/ledger";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await verifyApiKey(req.headers.get("authorization"));
  if (!auth) return apiError("UNAUTHORIZED", "Invalid or missing API key", 401);
  const t = await db.transfer.findFirst({
    where: { id: params.id, organizationId: auth.organizationId },
    include: { deposits: { select: { status: true, txHash: true, confirmations: true } } },
  });
  if (!t) return apiError("NOT_FOUND", "Transfer not found", 404);
  const bal = await transferBalances(db, t.id);
  return apiSuccess({
    ...serializeTransfer(t),
    memo_ledger_usd_cents: Object.fromEntries(Object.entries(bal).map(([k, v]) => [k, Number(v)])),
  });
}
