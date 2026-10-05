// Official-registry lookups (government or regulator-run sources). A lookup answers "does this identifier exist, is it
// active, and what is the registered legal name/address". It never proves the applicant owns the identifier.
export type RegistryCode = "VAT_ID" | "LEI" | "REG_NO" | "ABN" | "GSTIN";

export interface RegistryRecord {
  /** UNAVAILABLE = source could not answer (down, rate-limited, not configured): fall back to manual review, never treat as "invalid". */
  status: "FOUND" | "NOT_FOUND" | "UNAVAILABLE";
  source: string;
  sourceUrl: string;
  legalName?: string;
  address?: string;
  /** Registry's own active/dissolved flag where it has one. */
  active?: boolean;
  details: Record<string, unknown>;
  reason?: string;
  checkedAt: string;
}

export interface RegistryAdapter {
  readonly id: string;
  /** Needs credentials we do not have (so the UI can say "enter details manually"). */
  configured(): boolean;
  supports(code: RegistryCode, country: string): boolean;
  lookup(code: RegistryCode, value: string, country: string): Promise<RegistryRecord>;
}

export const nowIso = () => new Date().toISOString();
