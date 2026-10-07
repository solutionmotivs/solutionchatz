// Shared types for the stablecoin / cross-border transfer module.
// Vaulte never holds funds: every leg below is executed and custodied by a licensed partner.

export type Token = "USDC" | "USDT" | "EURC";
/** The currency one unit of each token is redeemable for (1 token = 1 unit). Stablecoin funding is priced in that currency. */
export const TOKEN_PEG: Record<Token, string> = { USDC: "USD", USDT: "USD", EURC: "EUR" };
export const TOKENS: Token[] = ["USDC", "USDT", "EURC"];
export type Chain = "solana" | "base" | "ethereum" | "tron" | "polygon";
export type TransferKindT = "BUSINESS" | "PERSONAL";
export type FundingMethodT = "STABLECOIN" | "FIAT_LOCAL" | "VIRTUAL_ACCOUNT";
export type Preference = "cheapest" | "fastest" | "balanced" | "same_day";

/** Which regulatory permission the partner holds for an India-facing leg. */
export type IndiaAuth = "PA_CB_E" | "PA_CB_I" | "MTSS" | "LRS_AD";

export type LegKind =
  | "ACCEPT_TOKEN" // partner receives stablecoin on a deposit address it controls (offshore)
  | "ONRAMP_FIAT" // sender pays fiat on a local rail, partner mints/buys stablecoin
  | "OFFRAMP" // stablecoin -> fiat, paid out on a local rail
  | "DIRECT" // fiat -> fiat with no stablecoin (local rails or authorised outward partner)
  | "INDIA_PAYOUT"; // authorised India partner turns hard-currency fiat into INR in a bank account

export interface Leg {
  id: string;
  partner: string;
  kind: LegKind;
  /** ISO country of the licensed entity executing the leg (informational / routing). */
  country: string;
  /** Regulatory bucket used for token rules, e.g. EU, UK, US, UAE, SG, IN. */
  jurisdiction: string;
  /** ONRAMP_FIAT / DIRECT source currency; OFFRAMP / DIRECT destination currency. */
  srcCurrency?: string;
  destCurrency?: string;
  /** DIRECT from INR may reach several destination currencies. */
  destCurrencies?: string[];
  /** INDIA_PAYOUT accepts these hard currencies as input. */
  acceptsFiat?: string[];
  rails: string[];
  tokens: Token[];
  chains: Chain[];
  /** FX / conversion spread charged by the partner, in basis points. */
  spreadBps: number;
  /** Percentage fee charged by the partner, in basis points. */
  feeBps: number;
  fixedFeeUsd: number;
  etaSec: number;
  minUsd: number;
  maxUsd: number;
  kinds: TransferKindT[];
  indiaAuth?: IndiaAuth;
  /** Present on legs priced live by an FX provider at quote time (rate is firm until validUntil). */
  live?: { provider: string; quoteId?: string; rate: number; midRate: number; validUntil: string };
}

export interface Route {
  id: string;
  legs: Leg[];
  token: Token | null;
  chain: Chain | null;
  partners: string[];
  spreadBps: number;
  feeBps: number;
  fixedFeeUsd: number;
  etaSec: number;
  minUsd: number;
  maxUsd: number;
  usesStablecoin: boolean;
}

/** units of currency per 1 USD (USD = 1). */
export type RateTable = Record<string, number>;

export interface CostBreakdown {
  sourceCurrency: string;
  destCurrency: string;
  sourceAmountUsd: number;
  midRateSourcePerUsd: number;
  midRateDestPerUsd: number;
  partnerSpreadUsd: number;
  partnerFeeUsd: number;
  networkFeeUsd: number;
  partnerCostUsd: number;
  markupBps: number;
  markupUsd: number;
  totalCostUsd: number;
  totalCostBps: number;
  destAmountUsd: number;
  bankWireEstimateCostUsd: number;
  savingsVsBankUsd: number;
  /** Set when the cheapest route uses a live-priced FX provider: which providers were compared. */
  fx?: FxSummary;
}

export interface FxSummary {
  provider: string;
  rate: number;
  mid_rate: number;
  spread_bps: number;
  rail: string;
  valid_until: string;
  compared: { provider: string; rate: number; spread_bps: number; fee_usd: number; rail: string; eta_seconds: number; cut_off_at?: string; chosen: boolean }[];
  errors: { provider: string; error: string }[];
}
