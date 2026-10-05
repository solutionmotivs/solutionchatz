// Registry lookup front door: pick the adapter, cache answers (so repeat lookups cost nothing), and cap lookups per
// organisation (so paid/rate-limited sources cannot be run up by a script).
import { getProvider } from "../providers";
import { defaultAdapters } from "./adapters";
import { nowIso, type RegistryAdapter, type RegistryCode, type RegistryRecord } from "./types";

export * from "./types";

let override: RegistryAdapter[] | null = null;
export function setRegistryAdaptersForTests(a: RegistryAdapter[] | null) { override = a; cache.clear(); }
const adapters = () => override ?? defaultAdapters();

const cache = new Map<string, { at: number; rec: RegistryRecord }>();
const TTL_MS = 24 * 3600_000;       // official data changes slowly; a day is safe for onboarding
const NEGATIVE_TTL_MS = 10 * 60_000; // do not hammer a registry for an identifier that was just "not found"

/** True when some source can answer this identifier type for this country. */
export function registrySupports(code: RegistryCode, country: string): boolean {
  if (code === "GSTIN") return country === "IN" && !!getProvider()?.supports("GSTIN", "IN");
  return adapters().some(a => a.supports(code, country));
}

/** `nameHint` is forwarded only to providers that can use it (the dev mock echoes it); real registries ignore it. */
export async function lookupRegistry(code: RegistryCode, value: string, country: string, nameHint?: string): Promise<RegistryRecord> {
  const key = `${country}:${code}:${value.toUpperCase().replace(/\s/g, "")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.rec.status === "FOUND" ? TTL_MS : NEGATIVE_TTL_MS)) return hit.rec;

  let rec: RegistryRecord;
  if (code === "GSTIN") {
    // India: GSTIN public-register lookup goes through the configured verification provider (the GST portal itself needs a captcha).
    const p = getProvider();
    if (!p || !p.supports("GSTIN", country)) rec = { status: "UNAVAILABLE", source: "gstn", sourceUrl: "https://services.gst.gov.in/services/searchtp", details: {}, reason: "No GSTIN lookup provider configured", checkedAt: nowIso() };
    else {
      const r = await p.verify({ code: "GSTIN", value, country, holder: "BUSINESS", name: p.name === "mock" ? nameHint : undefined });
      rec = {
        status: r.status === "VERIFIED" ? "FOUND" : r.status === "FAILED" ? "NOT_FOUND" : "UNAVAILABLE", source: r.provider, sourceUrl: "https://services.gst.gov.in/services/searchtp",
        legalName: r.details.registered_name as string | undefined, active: r.status === "VERIFIED" ? true : undefined,
        details: { gst_status: r.details.status, state: r.details.state, registered_pan: r.details.registered_pan }, reason: r.reason, checkedAt: nowIso(),
      };
    }
  } else {
    const a = adapters().find(x => x.supports(code, country));
    rec = a ? await a.lookup(code, value, country) : { status: "UNAVAILABLE", source: "none", sourceUrl: "", details: {}, reason: "No official lookup is wired for this identifier; staff will verify it manually", checkedAt: nowIso() };
  }
  if (rec.status !== "UNAVAILABLE" && rec.source !== "mock") cache.set(key, { at: Date.now(), rec });
  return rec;
}

const tokens = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\b(pvt|private|ltd|limited|llc|llp|inc|incorporated|corp|corporation|gmbh|ag|sa|sarl|bv|nv|plc|co|company|pty|sdn|bhd|fze|fzco|fzc|the|and)\b/g, " ").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);

/** Share of the registered name's words found in what the applicant typed (legal-form words ignored). 1 = same name. */
export function nameMatchScore(entered: string, registered: string): number {
  const a = new Set(tokens(entered)), b = tokens(registered);
  if (!b.length || !a.size) return 0;
  return b.filter(t => a.has(t)).length / Math.max(b.length, a.size);
}
