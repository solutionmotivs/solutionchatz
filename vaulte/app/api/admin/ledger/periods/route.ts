// GET periods; POST {period_id} closes a finished period (snapshot + hash). There is no reopen: post corrections in an open period.
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";
import { parseJson } from "@/lib/kyc/api";
import { LedgerError } from "@/lib/ledger/gl";
import { closePeriod } from "@/lib/ledger/reports";

export async function GET(req: NextRequest) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  const rows = await db.glPeriod.findMany({ orderBy: { id: "desc" }, take: 36 });
  return apiSuccess({ data: rows.map(p => ({ id: p.id, status: p.status, starts_on: p.startsOn, ends_on: p.endsOn, closed_at: p.closedAt, snapshot_hash: p.snapshotHash })) });
}

export async function POST(req: NextRequest) {
  const staff = await requireStaff(req);
  if (staff.response) return staff.response;
  const p = await parseJson(req, z.object({ period_id: z.string().regex(/^\d{4}-\d{2}$/) }));
  if (p.response) return p.response;
  try {
    const r = await closePeriod(p.data.period_id, staff.user.id);
    return apiSuccess({ id: r.id, status: r.status, snapshot_hash: r.snapshotHash });
  } catch (e) {
    if (e instanceof LedgerError) return apiError("CANNOT_CLOSE", e.message, 409);
    throw e;
  }
}
