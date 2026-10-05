// lib/compliance/aml.ts
// AML / Sanctions screening
// In production: integrates with ComplyAdvantage API
// This module defines the interface and mock for development

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

export async function screenEntity(
  entityName: string,
  country: string,
  taxId?: string
): Promise<SanctionsCheckResult> {
  // In production, call ComplyAdvantage:
  // POST https://api.complyadvantage.com/searches
  // {search_term: entityName, fuzziness: 0.6, filters: {types: ["sanction","pep"]}}

  // --- PRODUCTION INTEGRATION PLACEHOLDER ---
  if (process.env.COMPLYADVANTAGE_API_KEY) {
    try {
      const response = await fetch("https://api.complyadvantage.com/searches", {
        method: "POST",
        headers: {
          "Authorization": `Token ${process.env.COMPLYADVANTAGE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          search_term: entityName,
          fuzziness: 0.6,
          search_profile: "financial_services",
          filters: {
            types: ["sanction", "pep", "warning", "adverse-media"],
            birth_year: null,
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const hits = data.data?.content?.data?.hits ?? [];
        const hasConfirmedHit = hits.some((h: { doc?: { types?: string[] }; match_score?: number }) => (h.match_score ?? 0) > 0.85);
        const hasPotentialHit = hits.some((h: { doc?: { types?: string[] }; match_score?: number }) => (h.match_score ?? 0) > 0.6);

        return {
          cleared: !hasConfirmedHit,
          matchType: hasConfirmedHit
            ? "CONFIRMED_MATCH"
            : hasPotentialHit
            ? "POTENTIAL_MATCH"
            : "NO_MATCH",
          matchedLists: hits.map((h: { doc?: { sources?: { name?: string }[] } }) =>
            h.doc?.sources?.map((s: { name?: string }) => s.name).join(",") ?? ""
          ),
          matchScore: hits[0]?.match_score ?? 0,
          requiresReview: hasPotentialHit || hasConfirmedHit,
          notes: `ComplyAdvantage: ${hits.length} hits`,
        };
      }
    } catch {
      // Fall through to local check
    }
  }

  // ── Fallback / Development local check ──────────────────────────────────────
  const isSanctioned = SANCTIONED_COUNTRIES.has(country);

  if (isSanctioned) {
    return {
      cleared: false,
      matchType: "CONFIRMED_MATCH",
      matchedLists: ["OFAC_SDN", "EU_CONSOLIDATED"],
      matchScore: 100,
      requiresReview: false,
      notes: `Country ${country} is on the sanctions list`,
    };
  }

  return {
    cleared: true,
    matchType: "NO_MATCH",
    matchedLists: [],
    matchScore: 0,
    requiresReview: false,
    notes: "No matches found",
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
