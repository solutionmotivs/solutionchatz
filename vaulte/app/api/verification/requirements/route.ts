// GET /api/verification/requirements?kind=KYB&country=IN&purposes=EXPORT_SERVICES,EXPORT_GOODS — what will be asked.
import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth-guards";
import { apiError, apiSuccess } from "@/lib/utils";
import { PURPOSES, requirementsFor, validPurposes, type CaseKind } from "@/lib/kyc/requirements";

export async function GET(req: NextRequest) {
  const g = await requireUser(req);
  if (g.response) return g.response;
  const q = req.nextUrl.searchParams;
  const kind = q.get("kind");
  if (kind !== "KYB" && kind !== "KYC") return apiError("VALIDATION_ERROR", "kind must be KYB or KYC", 400, "kind");
  const country = (q.get("country") ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return apiError("VALIDATION_ERROR", "country must be a 2-letter code", 400, "country");
  const purposes = (q.get("purposes") ?? "").split(",").filter(Boolean);
  const allowed = validPurposes(kind as CaseKind);
  if (purposes.some(p => !allowed.includes(p))) return apiError("VALIDATION_ERROR", "Unknown purpose", 400, "purposes");
  const r = requirementsFor(kind as CaseKind, country, purposes);
  return apiSuccess({ purposes: PURPOSES[kind as CaseKind], profile: r.profile, items: r.items.map(({ validate: _v, ...x }) => x), documents: r.documents, people: r.people, ubo_threshold_pct: r.uboThresholdPct, notes: r.notes });
}
