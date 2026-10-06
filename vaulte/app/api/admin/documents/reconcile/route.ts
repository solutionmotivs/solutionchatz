// POST /api/admin/documents/reconcile — staff: import an EDPMS/IRM or eBRC report (CSV text) and attach the numbers to matching transfers.
import { NextRequest } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";
import { reconcileEdpms } from "@/lib/documents/reconcile";

const Schema = z.object({ csv: z.string().min(10).max(2_000_000) });

export async function POST(req: NextRequest) {
  const g = await requireStaff(req);
  if (g.response) return g.response;
  let raw: unknown; try { raw = await req.json(); } catch { return apiError("INVALID_JSON", "Body must be JSON", 400); }
  const p = Schema.safeParse(raw);
  if (!p.success) return apiError("VALIDATION_ERROR", p.error.errors[0].message, 400, "csv");
  return apiSuccess(await reconcileEdpms(p.data.csv, g.user.id, g.user.organizationId));
}
