// lib/rails/router.ts
// Smart rail selection engine — picks cheapest/fastest rail per corridor

import type { PaymentRailType, Currency } from "@/types";

interface RailOption {
  rail: PaymentRailType;
  estimatedSeconds: number; // T+0 = 0, T+1 = 86400, etc.
  networkFeeCents: number;  // fixed network fee in USD cents
  available: boolean;
}

interface RoutingContext {
  sourceCurrency: Currency;
  destCurrency: Currency;
  sourceCountry: string;    // ISO 3166-1 alpha-2
  destCountry: string;
  amountUsd: number;        // normalised amount for limit checks
}

// Rail availability matrix per currency/country pair
const RAIL_MATRIX: Record<string, PaymentRailType[]> = {
  // EU → EU
  "EUR-EUR": ["SEPA_INSTANT", "SEPA_CREDIT", "SWIFT_GPI"],
  // UK
  "GBP-GBP": ["SEPA_CREDIT", "SWIFT_GPI"],
  // US domestic
  "USD-USD-US": ["FEDNOW", "ACH_SAME_DAY", "ACH_STANDARD", "SWIFT_GPI"],
  // USD cross-border
  "USD-USD": ["SWIFT_GPI"],
  // India domestic
  "INR-INR": ["UPI", "RTGS", "NEFT"],
  // Cross-currency default
  "CROSS": ["SWIFT_GPI"],
};

const RAIL_STATS: Record<PaymentRailType, { avgSeconds: number; fixedFeeUsdCents: number }> = {
  SEPA_INSTANT:  { avgSeconds: 10,      fixedFeeUsdCents: 22   }, // ~€0.20
  SEPA_CREDIT:   { avgSeconds: 86400,   fixedFeeUsdCents: 22   },
  FEDNOW:        { avgSeconds: 30,      fixedFeeUsdCents: 50   },
  ACH_SAME_DAY:  { avgSeconds: 21600,   fixedFeeUsdCents: 50   }, // 6h
  ACH_STANDARD:  { avgSeconds: 172800,  fixedFeeUsdCents: 30   }, // 2 days
  SWIFT_GPI:     { avgSeconds: 1800,    fixedFeeUsdCents: 2200 }, // $22
  UPI:           { avgSeconds: 5,       fixedFeeUsdCents: 5    },
  RTGS:          { avgSeconds: 300,     fixedFeeUsdCents: 20   },
  NEFT:          { avgSeconds: 7200,    fixedFeeUsdCents: 10   },
  AUTO:          { avgSeconds: 0,       fixedFeeUsdCents: 0    },
};

export function selectRail(
  requestedRail: PaymentRailType,
  ctx: RoutingContext
): { rail: PaymentRailType; estimatedArrival: Date; networkFeeCents: number } {
  const now = new Date();

  // If explicit rail is requested (not AUTO), validate and use it
  if (requestedRail !== "AUTO") {
    const stats = RAIL_STATS[requestedRail];
    return {
      rail: requestedRail,
      estimatedArrival: new Date(now.getTime() + stats.avgSeconds * 1000),
      networkFeeCents: stats.fixedFeeUsdCents,
    };
  }

  // AUTO routing: pick best rail for corridor
  let candidates: PaymentRailType[] = [];

  const { sourceCurrency, destCurrency, sourceCountry, destCountry, amountUsd } = ctx;

  // India domestic
  if (sourceCurrency === "INR" && destCurrency === "INR") {
    if (amountUsd > 200000) {
      candidates = ["RTGS"];
    } else {
      candidates = ["UPI", "RTGS", "NEFT"];
    }
  }
  // EUR zone
  else if (sourceCurrency === "EUR" && destCurrency === "EUR") {
    candidates = ["SEPA_INSTANT", "SEPA_CREDIT"];
  }
  // USD US domestic
  else if (
    sourceCurrency === "USD" &&
    destCurrency === "USD" &&
    sourceCountry === "US" &&
    destCountry === "US"
  ) {
    candidates = ["FEDNOW", "ACH_SAME_DAY", "ACH_STANDARD"];
  }
  // Cross-border or cross-currency: SWIFT
  else {
    candidates = ["SWIFT_GPI"];
  }

  // Pick fastest available
  const best = candidates[0] ?? "SWIFT_GPI";
  const stats = RAIL_STATS[best];

  return {
    rail: best,
    estimatedArrival: new Date(now.getTime() + stats.avgSeconds * 1000),
    networkFeeCents: stats.fixedFeeUsdCents,
  };
}

export function calculateFee(
  amountMinorUnits: bigint,
  feeRateBps: number = 40 // 0.40% = 40 bps
): bigint {
  return (amountMinorUnits * BigInt(feeRateBps)) / BigInt(10000);
}

export function estimateArrivalLabel(rail: PaymentRailType): string {
  const map: Record<PaymentRailType, string> = {
    SEPA_INSTANT: "~10 seconds",
    SEPA_CREDIT: "1 business day",
    FEDNOW: "~30 seconds",
    ACH_SAME_DAY: "Same day",
    ACH_STANDARD: "2 business days",
    SWIFT_GPI: "30 min – 2 hours",
    UPI: "~5 seconds",
    RTGS: "~5 minutes",
    NEFT: "2 hours",
    AUTO: "Varies",
  };
  return map[rail] ?? "Unknown";
}
