import type { NextRequest } from "next/server";
import { orgContext } from "@/lib/documents/api";
import { apiError } from "@/lib/utils";
import { ADAPTERS } from "./connectors";

export const PROVIDERS = ["QUICKBOOKS", "ZOHO", "XERO", "TALLY"] as const;
export type Provider = (typeof PROVIDERS)[number];

export function providerOf(raw: string): Provider | null {
  const p = raw.toUpperCase();
  return (PROVIDERS as readonly string[]).includes(p) ? (p as Provider) : null;
}

/** Customer-side auth for integrations: owners/admins manage connections; finance can run exports. */
export async function integrationContext(req: NextRequest, opts: { manage?: boolean } = {}) {
  const c = await orgContext(req, { write: !!opts.manage });
  if (c.response) return c;
  if (opts.manage && c.role && !["OWNER", "ADMIN"].includes(c.role)) return { response: apiError("FORBIDDEN", "Only owners and admins can manage integrations", 403) } as const;
  if (opts.manage && !c.role) return { response: apiError("FORBIDDEN", "Managing integrations needs a signed-in user, not an API key", 403) } as const;
  return c;
}

export const configured = (p: Provider) => (p === "TALLY" ? true : ADAPTERS[p].configured());
