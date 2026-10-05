import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";
import { parseJson } from "@/lib/kyc/api";
import { LedgerError, reverseJournal } from "@/lib/ledger/gl";

const Body = z.object({ memo: z.string().min(10).max(500) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  const p = await parseJson(req, Body);
  if (p.response) return p.response;
  try {
    const j = await db.$transaction(tx => reverseJournal(tx, params.id, { memo: p.data.memo, createdById: staff.user.id }));
    return apiSuccess({ id: j.id, seq: j.seq, reversal_of: params.id }, 201);
  } catch (e) {
    if (e instanceof LedgerError) return apiError("LEDGER_REJECTED", e.message, 422);
    return apiError("NOT_FOUND", "Journal not found", 404);
  }
}
