// Customer risk scoring and the due-diligence tier it produces. Simple, explainable, additive points.
// Thresholds are product defaults for counsel / the compliance officer to tune, not regulatory text.
import { isSanctionedCountry } from "@/lib/compliance/aml";

export type Tier = "SDD" | "CDD" | "EDD";

/** FATF "call for action" jurisdictions (Oct 2025 snapshot): onboarding is refused. */
export const BLOCKED_COUNTRIES = new Set(["KP", "IR", "MM"]);

/** FATF "increased monitoring" snapshot. This list changes three times a year: refresh via FATF_INCREASED_MONITORING. */
const GREY_DEFAULT = "DZ,AO,BO,BG,CM,CI,CD,HT,KE,LA,LB,MC,NP,SS,SY,VE,VN,VG,YE";
export function greyCountries(): Set<string> {
  return new Set((process.env.FATF_INCREASED_MONITORING ?? GREY_DEFAULT).split(",").map(s => s.trim().toUpperCase()).filter(Boolean));
}

const HIGH_RISK_INDUSTRY = /crypto|virtual asset|exchange|gambl|casino|betting|forex|money (service|transfer|changer)|remittance|precious|jewel|gold|arms|weapon|shell|adult/i;

export interface RiskInput {
  kind: "KYB" | "KYC";
  country: string;
  purposes: string[];
  industry?: string;
  expectedMonthlyUsd?: number;
  incorporationDate?: string;
  people: { role: string; isPep: boolean; nationality?: string | null; countryOfResidence?: string | null; ownershipPct?: number | null }[];
  items: { status: string }[];
  /** Name screening result for the subject and its people (see lib/compliance). */
  screening: "CLEAR" | "REVIEW" | "BLOCK";
}

export interface RiskFactor { code: string; points: number; detail: string }
export interface RiskResult { score: number; tier: Tier | null; blocked: boolean; factors: RiskFactor[]; eddRequired: boolean }

export function assessRisk(i: RiskInput, now = new Date()): RiskResult {
  const f: RiskFactor[] = [];
  const add = (code: string, points: number, detail: string) => f.push({ code, points, detail });
  const grey = greyCountries();
  let blocked = false;
  let edd = false;

  const countries = new Set<string>([i.country, ...i.people.flatMap(p => [p.nationality, p.countryOfResidence]).filter((x): x is string => !!x)].map(c => c.toUpperCase()));
  for (const c of Array.from(countries)) {
    if (BLOCKED_COUNTRIES.has(c) || isSanctionedCountry(c)) { blocked = true; add("BLOCKED_JURISDICTION", 100, `${c} is a prohibited jurisdiction`); }
    else if (grey.has(c)) add("INCREASED_MONITORING_JURISDICTION", c === i.country ? 20 : 10, `${c} is on the FATF increased-monitoring list`);
  }
  if (i.people.some(p => p.isPep)) { add("PEP", 35, "A related person is a politically exposed person"); edd = true; }
  if (i.industry && HIGH_RISK_INDUSTRY.test(i.industry)) { add("HIGH_RISK_INDUSTRY", 30, `Industry "${i.industry}"`); edd = true; }
  const v = i.expectedMonthlyUsd ?? 0;
  if (v > 1_000_000) add("VOLUME_VERY_HIGH", 25, "Expected monthly volume above USD 1M");
  else if (v > 250_000) add("VOLUME_HIGH", 15, "Expected monthly volume above USD 250k");
  else if (v > 50_000) add("VOLUME_ELEVATED", 8, "Expected monthly volume above USD 50k");
  if (i.kind === "KYB") {
    const owned = i.people.filter(p => p.role === "UBO").reduce((s, p) => s + (p.ownershipPct ?? 0), 0);
    if (owned < 75) add("OWNERSHIP_NOT_FULLY_IDENTIFIED", 10, `Only ${owned.toFixed(0)}% of ownership identified`);
    if (i.people.filter(p => p.role === "UBO").length > 5) add("COMPLEX_OWNERSHIP", 5, "More than five beneficial owners");
    if (i.incorporationDate) {
      const months = (now.getTime() - new Date(i.incorporationDate).getTime()) / (30.44 * 86400000);
      if (months < 12) add("NEW_BUSINESS", 10, "Incorporated less than 12 months ago");
    }
  }
  if (i.purposes.includes("LRS_OUTWARD")) add("LRS", 5, "Outward remittance under LRS");
  if (i.purposes.includes("IMPORT_GOODS")) add("TRADE_BASED_LAUNDERING_EXPOSURE", 5, "Pays for imported goods");
  const manual = i.items.filter(x => x.status === "MANUAL" || x.status === "PENDING").length;
  if (manual) add("MANUAL_VERIFICATION", 5, `${manual} identifier(s) not auto-verified`);
  if (i.screening === "REVIEW") { add("SCREENING_POTENTIAL_MATCH", 30, "Possible sanctions/PEP list match to be reviewed"); edd = true; }
  if (i.screening === "BLOCK") { blocked = true; add("SCREENING_CONFIRMED_MATCH", 100, "Matches a sanctions list"); }

  const score = Math.min(100, f.reduce((s, x) => s + x.points, 0));
  if (blocked) return { score: 100, tier: null, blocked: true, factors: f, eddRequired: false };
  const eddRequired = edd || score >= 55;
  const tier: Tier = eddRequired ? "EDD" : score <= 15 ? "SDD" : "CDD";
  return { score, tier, blocked: false, factors: f, eddRequired };
}

export interface TierLimits { perTxnUsd: number; dailyUsd: number; monthlyUsd: number }

/** Transaction limits by due-diligence tier. Whole US dollars. */
export function tierLimits(kind: "KYB" | "KYC", tier: Tier | null | undefined): TierLimits {
  if (!tier) return { perTxnUsd: 0, dailyUsd: 0, monthlyUsd: 0 };
  const t = {
    KYC: { SDD: [1_000, 1_000, 2_500], CDD: [10_000, 15_000, 50_000], EDD: [25_000, 30_000, 100_000] },
    KYB: { SDD: [10_000, 15_000, 50_000], CDD: [250_000, 300_000, 2_000_000], EDD: [1_000_000, 1_500_000, 10_000_000] },
  }[kind][tier];
  return { perTxnUsd: t[0], dailyUsd: t[1], monthlyUsd: t[2] };
}

/** EDD needs two different staff approvals (four-eyes). */
export function approvalsNeeded(tier: Tier | null | undefined): number {
  return tier === "EDD" ? 2 : 1;
}

/** Periodic review: high risk yearly, medium every two years, low every three. */
export function nextReviewDate(tier: Tier, from = new Date()): Date {
  const years = tier === "EDD" ? 1 : tier === "CDD" ? 2 : 3;
  const d = new Date(from);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}
