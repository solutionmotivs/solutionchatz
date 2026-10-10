// lib/compliance/aml.ts
// AML / sanctions screening entry points. Name screening runs against the official lists (lib/sanctions).

import { screenName, type Ctx } from "@/lib/sanctions/screen";

export interface SanctionsCheckResult {
  cleared: boolean;
  matchType: "NO_MATCH" | "POTENTIAL_MATCH" | "CONFIRMED_MATCH";
  matchedLists: string[];   // e.g. ["OFAC_SDN", "UN_CONSOLIDATED"]
  matchScore: number;       // 0-100
  requiresReview: boolean;
  notes: string;
}

export interface TransactionRiskResult {
  riskScore: number;        // 0-100
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  flags: RiskFlag[];
  autoApprove: boolean;
}

export interface RiskFlag {
  code: string;
  description: string;
  severity: "INFO" | "WARN" | "CRITICAL";
}

// Sanctioned country list (incomplete — for illustration)
const HIGH_RISK_COUNTRIES = new Set([
  "IR", "KP", "SY", "CU", "VE", "MM", "BY", "RU",
]);

const SANCTIONED_COUNTRIES = new Set([
  "IR", "KP", "SY", "CU",
]);

export interface ScreenOptions {
  kind?: "INDIVIDUAL" | "ENTITY";
  dateOfBirth?: string;
  organizationId?: string;
  subjectType?: Ctx["subjectType"];
  subjectId?: string;
}

/**
 * Screens a name against the mirrored OFAC SDN, UN and UK lists (see lib/sanctions).
 * cleared = no match at all. A possible match ("POTENTIAL_MATCH") is held for staff review; a hard match is blocked.
 */
export async function screenEntity(entityName: string, country: string, opts: ScreenOptions = {}): Promise<SanctionsCheckResult> {
  if (SANCTIONED_COUNTRIES.has(country)) {
    return { cleared: false, matchType: "CONFIRMED_MATCH", matchedLists: ["COUNTRY_PROHIBITED"], matchScore: 100, requiresReview: false, notes: `Country ${country} is a prohibited jurisdiction` };
  }
  const r = await screenName(
    { name: entityName, country, kind: opts.kind, dateOfBirth: opts.dateOfBirth },
    { organizationId: opts.organizationId, subjectType: opts.subjectType ?? "TRANSFER_PARTY", subjectId: opts.subjectId },
  );
  const lists = Array.from(new Set(r.matches.filter(m => m.score >= 88).map(m => m.list)));
  return {
    cleared: r.outcome === "CLEAR",
    matchType: r.outcome === "BLOCK" ? "CONFIRMED_MATCH" : r.outcome === "REVIEW" ? "POTENTIAL_MATCH" : "NO_MATCH",
    matchedLists: lists,
    matchScore: r.topScore,
    requiresReview: r.outcome === "REVIEW",
    notes: r.note ?? (r.outcome === "CLEAR" ? "No matches found" : `${r.matches.length} candidate match(es); check ${r.checkId}`),
  };
}

export function assessTransactionRisk(
  amountUsd: number,
  senderCountry: string,
  recipientCountry: string,
  businessType: string
): TransactionRiskResult {
  const flags: RiskFlag[] = [];
  let riskScore = 0;

  // Large value
  if (amountUsd > 10_000_000) {
    riskScore += 30;
    flags.push({ code: "LARGE_VALUE", description: "Transaction over $10M", severity: "WARN" });
  } else if (amountUsd > 1_000_000) {
    riskScore += 10;
    flags.push({ code: "HIGH_VALUE", description: "Transaction over $1M", severity: "INFO" });
  }

  // High risk countries
  if (HIGH_RISK_COUNTRIES.has(senderCountry) || HIGH_RISK_COUNTRIES.has(recipientCountry)) {
    riskScore += 40;
    flags.push({ code: "HIGH_RISK_COUNTRY", description: "Sender or recipient in high-risk jurisdiction", severity: "WARN" });
  }

  // Sanctioned countries — block immediately
  if (SANCTIONED_COUNTRIES.has(senderCountry) || SANCTIONED_COUNTRIES.has(recipientCountry)) {
    riskScore = 100;
    flags.push({ code: "SANCTIONED_COUNTRY", description: "Transaction involves sanctioned jurisdiction", severity: "CRITICAL" });
  }

  // High-risk industries
  const highRiskIndustries = ["crypto", "gambling", "arms", "adult"];
  if (highRiskIndustries.some(i => businessType.toLowerCase().includes(i))) {
    riskScore += 35;
    flags.push({ code: "HIGH_RISK_INDUSTRY", description: "Business type requires enhanced due diligence", severity: "WARN" });
  }

  const riskLevel =
    riskScore >= 80 ? "CRITICAL" :
    riskScore >= 50 ? "HIGH" :
    riskScore >= 25 ? "MEDIUM" : "LOW";

  return {
    riskScore,
    riskLevel,
    flags,
    autoApprove: riskScore < 50,
  };
}

export function isSanctionedCountry(country: string): boolean {
  return SANCTIONED_COUNTRIES.has(country.toUpperCase());
}

export function isHighRiskCountry(country: string): boolean {
  return HIGH_RISK_COUNTRIES.has(country.toUpperCase());
}
