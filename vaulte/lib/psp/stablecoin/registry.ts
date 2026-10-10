// Maps partner ids used in routes (e.g. "mock_eu", "mock_eu_b") to adapters.
// Real adapters (Bridge, BVNK, Xflow, OnMeta, ...) plug in here once agreements and keys exist.
import { niumFromEnv } from "@/lib/psp/nium/client";
import { NiumPartner } from "@/lib/psp/nium/partner";
import { currencycloudFromEnv } from "@/lib/psp/currencycloud/client";
import { CurrencycloudPartner } from "@/lib/psp/currencycloud/partner";
import { circleFromEnv } from "@/lib/psp/circle/client";
import { CirclePartner } from "@/lib/psp/circle/partner";
import { cashfreeFromEnv } from "@/lib/psp/cashfree/client";
import { CashfreePartner } from "@/lib/psp/cashfree/partner";
import { wiseFromEnv } from "@/lib/psp/wise/client";
import { WisePartner } from "@/lib/psp/wise/partner";
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
  if (id === "currencycloud") { const c = currencycloudFromEnv(); if (!c) throw new Error("Currencycloud is not configured (CURRENCYCLOUD_LOGIN_ID / CURRENCYCLOUD_API_KEY)"); const p = new CurrencycloudPartner(c); cache.set(id, p); return p; }
  if (id === "nium") { const c = niumFromEnv(); if (!c) throw new Error("Nium is not configured (NIUM_API_KEY / NIUM_CLIENT_HASH_ID)"); const p = new NiumPartner(c); cache.set(id, p); return p; }
  if (id === "cashfree") { const c = cashfreeFromEnv(); if (!c) throw new Error("Cashfree is not configured (CASHFREE_CLIENT_ID / CASHFREE_CLIENT_SECRET)"); const p = new CashfreePartner(c); cache.set(id, p); return p; }
  if (id === "wise") { const c = wiseFromEnv(); if (!c) throw new Error("Wise is not configured (WISE_CLIENT_ID / WISE_CLIENT_SECRET)"); const p = new WisePartner(c); cache.set(id, p); return p; }
  if (id === "circle") { const c = circleFromEnv(); if (!c) throw new Error("Circle is not configured (CIRCLE_API_KEY)"); const p = new CirclePartner(c); cache.set(id, p); return p; }
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
