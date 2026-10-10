// Data-subject requests: types, response deadlines per region, and the reference format.
import { randomBytes } from "crypto";

export const REQUEST_TYPES = ["ACCESS", "CORRECTION", "ERASURE", "WITHDRAW_CONSENT", "PORTABILITY", "OBJECTION", "RESTRICTION", "NOMINATE", "APPEAL", "OTHER"] as const;
export const REQUEST_STATUSES = ["RECEIVED", "IDENTITY_PENDING", "IN_PROGRESS", "COMPLETED", "PARTIALLY_COMPLETED", "REFUSED"] as const;
export const REQUEST_REGIONS = ["IN", "US", "AE", "SG", "EU", "UK", "OTHER"] as const;
export type RequestRegion = (typeof REQUEST_REGIONS)[number];

/** Days we promise to answer within. EU/UK: one month; US: 45 days; others: our 30-day commitment (stricter than the DPDP Rules' 90). */
export const RESPONSE_DAYS: Record<RequestRegion, number> = { IN: 30, US: 45, AE: 30, SG: 30, EU: 30, UK: 30, OTHER: 30 };

export function dueDate(region: RequestRegion, from = new Date()): Date {
  return new Date(from.getTime() + RESPONSE_DAYS[region] * 86_400_000);
}

export function newReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = randomBytes(8);
  return "DSR-" + Array.from(b, x => alphabet[x % alphabet.length]).join("");
}
