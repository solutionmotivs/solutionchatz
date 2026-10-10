// GET /api/verification/lookup?country=IN&code=GSTIN&value=24ABKCS2033B1ZV&name=optional
// Looks an identifier up in the official register so the form can show (and prefill) the registered legal name and address.
import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth-guards";
import { requirementsFor } from "@/lib/kyc/requirements";
import { lookupRegistry, nameMatchScore, type RegistryCode } from "@/lib/kyc/registries";
import { registryInfo } from "@/lib/kyc/countries";
import { normalise } from "@/lib/kyc/validators";
import { hit } from "@/lib/security/ratelimit-db";
import { apiError, apiSuccess } from "@/lib/utils";

export async function GET(req: NextRequest) {
  const g = await requireUser(req);
  if (g.response) return g.response;
  const q = req.nextUrl.searchParams;
  const country = (q.get("country") ?? "").toUpperCase();
  const code = q.get("code") ?? "";
  const raw = (q.get("value") ?? "").trim();
  if (!/^[A-Z]{2}$/.test(country)) return apiError("VALIDATION_ERROR", "country must be a 2-letter code", 400, "country");
  // Only identifiers that a registry can answer for this country, and only well-formed ones (saves paid/rate-limited calls).
  const spec = requirementsFor("KYB", country, []).items.find(i => i.code === code && i.registry);
  if (!spec || !spec.registry) return apiError("NOT_SUPPORTED", "No official lookup is available for this identifier; enter the details manually", 404, "code");
  const value = normalise(raw);
  const err = spec.validate(value);
  if (err) return apiError("INVALID_IDENTIFIER", err, 400, "value");
  // Cost control: 60 lookups per organisation per hour; repeats are served from cache and still counted.
  const lim = await hit(`lookup:${g.user.organizationId}`, 60, 3600);
  if (!lim.allowed) return apiError("RATE_LIMITED", "Too many lookups; try again later or enter the details manually", 429);
  const rec = await lookupRegistry(spec.registry as RegistryCode, value, country, q.get("name") ?? undefined);
  const entered = q.get("name");
  return apiSuccess({
    status: rec.status, legal_name: rec.legalName ?? null, address: rec.address ?? null, active: rec.active ?? null, source: rec.source, source_url: rec.sourceUrl,
    name_match: entered && rec.legalName ? Math.round(nameMatchScore(entered, rec.legalName) * 100) / 100 : null, reason: rec.reason ?? null, checked_at: rec.checkedAt,
    registry: registryInfo(country),
  });
}
