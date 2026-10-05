// Maps partner ids used in routes (e.g. "mock_eu", "mock_eu_b") to adapters.
// Real adapters (Bridge, BVNK, Xflow, OnMeta, ...) plug in here once agreements and keys exist.
import type { StablecoinPartner } from "./partner";
import { MockPartner } from "./mock";
import { AirwallexPartner } from "@/lib/psp/airwallex/partner";
import { airwallexFromEnv } from "@/lib/psp/airwallex/client";

const cache = new Map<string, StablecoinPartner>();

export function getPartner(id: string): StablecoinPartner {
  const hit = cache.get(id);
  if (hit) return hit;
  if (id.startsWith("mock_")) {
    const p = new MockPartner(id);
    cache.set(id, p);
    return p;
  }
  if (id === "airwallex") {
    const c = airwallexFromEnv();
    if (!c) throw new Error("Airwallex is not configured (AIRWALLEX_CLIENT_ID / AIRWALLEX_API_KEY)");
    const p = new AirwallexPartner(c);
    cache.set(id, p);
    return p;
  }
  throw new Error(`No adapter registered for partner "${id}"`);
}

/** Webhook route param -> adapter. Any "mock_*" id verifies with the shared mock secret. */
export function getPartnerForWebhook(id: string): StablecoinPartner | null {
  try {
    return getPartner(id);
  } catch {
    return null;
  }
}
