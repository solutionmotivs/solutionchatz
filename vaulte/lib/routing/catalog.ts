// Partner leg catalog. ALL NUMBERS BELOW ARE MOCK PLACEHOLDERS for sandbox and tests.
// Real values come from signed partner agreements / partner price APIs (firm quotes).
import type { Leg } from "@/lib/stablecoin/types";

const ALL_CHAINS = ["solana", "base", "ethereum", "tron", "polygon"] as const;
const FAST_CHAINS = ["solana", "base", "polygon"] as const;

const PRIMARY_LEGS: Leg[] = [
  // ── EU (MiCA): USDC only ─────────────────────────────────────────────────────
  {
    id: "eu.accept", partner: "mock_eu", kind: "ACCEPT_TOKEN", country: "DE", jurisdiction: "EU",
    rails: ["ONCHAIN"], tokens: ["USDC"], chains: [...FAST_CHAINS, "ethereum"],
    spreadBps: 0, feeBps: 3, fixedFeeUsd: 0, etaSec: 60, minUsd: 10, maxUsd: 1_000_000, kinds: ["BUSINESS", "PERSONAL"],
  },
  {
    id: "eu.onramp.eur", partner: "mock_eu", kind: "ONRAMP_FIAT", country: "DE", jurisdiction: "EU",
    srcCurrency: "EUR", rails: ["SEPA_INSTANT"], tokens: ["USDC"], chains: [...FAST_CHAINS, "ethereum"],
    spreadBps: 4, feeBps: 5, fixedFeeUsd: 0, etaSec: 30, minUsd: 10, maxUsd: 1_000_000, kinds: ["BUSINESS", "PERSONAL"],
  },
  {
    id: "eu.offramp.eur", partner: "mock_eu", kind: "OFFRAMP", country: "DE", jurisdiction: "EU",
    destCurrency: "EUR", rails: ["SEPA_INSTANT"], tokens: ["USDC"], chains: [...FAST_CHAINS, "ethereum"],
    spreadBps: 4, feeBps: 5, fixedFeeUsd: 0, etaSec: 60, minUsd: 10, maxUsd: 1_000_000, kinds: ["BUSINESS", "PERSONAL"],
  },
  {
    id: "eu.direct.eur", partner: "mock_eu", kind: "DIRECT", country: "DE", jurisdiction: "EU",
    srcCurrency: "EUR", destCurrency: "EUR", rails: ["SEPA_INSTANT"], tokens: [], chains: [],
    spreadBps: 0, feeBps: 2, fixedFeeUsd: 0.1, etaSec: 15, minUsd: 1, maxUsd: 1_000_000, kinds: ["BUSINESS", "PERSONAL"],
  },
  // ── UK ───────────────────────────────────────────────────────────────────────
  {
    id: "uk.accept", partner: "mock_uk", kind: "ACCEPT_TOKEN", country: "GB", jurisdiction: "UK",
    rails: ["ONCHAIN"], tokens: ["USDC", "USDT"], chains: [...ALL_CHAINS],
    spreadBps: 0, feeBps: 4, fixedFeeUsd: 0, etaSec: 60, minUsd: 10, maxUsd: 1_000_000, kinds: ["BUSINESS", "PERSONAL"],
  },
  {
    id: "uk.onramp.gbp", partner: "mock_uk", kind: "ONRAMP_FIAT", country: "GB", jurisdiction: "UK",
    srcCurrency: "GBP", rails: ["FASTER_PAYMENTS"], tokens: ["USDC", "USDT"], chains: [...ALL_CHAINS],
    spreadBps: 5, feeBps: 6, fixedFeeUsd: 0, etaSec: 45, minUsd: 10, maxUsd: 1_000_000, kinds: ["BUSINESS", "PERSONAL"],
  },
  {
    id: "uk.offramp.gbp", partner: "mock_uk", kind: "OFFRAMP", country: "GB", jurisdiction: "UK",
    destCurrency: "GBP", rails: ["FASTER_PAYMENTS"], tokens: ["USDC", "USDT"], chains: [...ALL_CHAINS],
    spreadBps: 5, feeBps: 6, fixedFeeUsd: 0, etaSec: 90, minUsd: 10, maxUsd: 1_000_000, kinds: ["BUSINESS", "PERSONAL"],
  },
  // ── US ───────────────────────────────────────────────────────────────────────
  {
    id: "us.accept", partner: "mock_us", kind: "ACCEPT_TOKEN", country: "US", jurisdiction: "US",
    rails: ["ONCHAIN"], tokens: ["USDC", "USDT"], chains: [...ALL_CHAINS],
    spreadBps: 0, feeBps: 3, fixedFeeUsd: 0, etaSec: 60, minUsd: 10, maxUsd: 5_000_000, kinds: ["BUSINESS", "PERSONAL"],
  },
  {
    id: "us.onramp.usd", partner: "mock_us", kind: "ONRAMP_FIAT", country: "US", jurisdiction: "US",
    srcCurrency: "USD", rails: ["FEDNOW", "ACH_SAME_DAY"], tokens: ["USDC", "USDT"], chains: [...ALL_CHAINS],
    spreadBps: 0, feeBps: 8, fixedFeeUsd: 0.25, etaSec: 120, minUsd: 10, maxUsd: 5_000_000, kinds: ["BUSINESS", "PERSONAL"],
  },
  {
    id: "us.offramp.usd", partner: "mock_us", kind: "OFFRAMP", country: "US", jurisdiction: "US",
    destCurrency: "USD", rails: ["FEDNOW", "ACH_SAME_DAY"], tokens: ["USDC", "USDT"], chains: [...ALL_CHAINS],
    spreadBps: 0, feeBps: 10, fixedFeeUsd: 0.25, etaSec: 300, minUsd: 10, maxUsd: 5_000_000, kinds: ["BUSINESS", "PERSONAL"],
  },
  {
    id: "us.direct.usd", partner: "mock_us", kind: "DIRECT", country: "US", jurisdiction: "US",
    srcCurrency: "USD", destCurrency: "USD", rails: ["FEDNOW"], tokens: [], chains: [],
    spreadBps: 0, feeBps: 3, fixedFeeUsd: 0.5, etaSec: 30, minUsd: 1, maxUsd: 500_000, kinds: ["BUSINESS", "PERSONAL"],
  },
  // ── UAE hub ──────────────────────────────────────────────────────────────────
  {
    id: "uae.accept", partner: "mock_uae", kind: "ACCEPT_TOKEN", country: "AE", jurisdiction: "UAE",
    rails: ["ONCHAIN"], tokens: ["USDT", "USDC"], chains: [...ALL_CHAINS],
    spreadBps: 0, feeBps: 4, fixedFeeUsd: 0, etaSec: 60, minUsd: 10, maxUsd: 2_000_000, kinds: ["BUSINESS", "PERSONAL"],
  },
  {
    id: "uae.onramp.aed", partner: "mock_uae", kind: "ONRAMP_FIAT", country: "AE", jurisdiction: "UAE",
    srcCurrency: "AED", rails: ["UAEFTS"], tokens: ["USDT", "USDC"], chains: [...ALL_CHAINS],
    spreadBps: 6, feeBps: 8, fixedFeeUsd: 0, etaSec: 120, minUsd: 10, maxUsd: 2_000_000, kinds: ["BUSINESS", "PERSONAL"],
  },
  {
    id: "uae.offramp.aed", partner: "mock_uae", kind: "OFFRAMP", country: "AE", jurisdiction: "UAE",
    destCurrency: "AED", rails: ["UAEFTS", "IPP"], tokens: ["USDT", "USDC"], chains: [...ALL_CHAINS],
    spreadBps: 6, feeBps: 8, fixedFeeUsd: 0, etaSec: 180, minUsd: 10, maxUsd: 2_000_000, kinds: ["BUSINESS", "PERSONAL"],
  },
  // ── Singapore ────────────────────────────────────────────────────────────────
  {
    id: "sg.accept", partner: "mock_sg", kind: "ACCEPT_TOKEN", country: "SG", jurisdiction: "SG",
    rails: ["ONCHAIN"], tokens: ["USDC", "USDT"], chains: [...ALL_CHAINS],
    spreadBps: 0, feeBps: 4, fixedFeeUsd: 0, etaSec: 60, minUsd: 10, maxUsd: 1_000_000, kinds: ["BUSINESS", "PERSONAL"],
  },
  {
    id: "sg.offramp.sgd", partner: "mock_sg", kind: "OFFRAMP", country: "SG", jurisdiction: "SG",
    destCurrency: "SGD", rails: ["FAST"], tokens: ["USDC", "USDT"], chains: [...ALL_CHAINS],
    spreadBps: 6, feeBps: 7, fixedFeeUsd: 0, etaSec: 90, minUsd: 10, maxUsd: 1_000_000, kinds: ["BUSINESS", "PERSONAL"],
  },
  // ── India: inbound payout (business: PA-CB export partner, personal: MTSS partner) ──
  {
    id: "in.payout.pacb", partner: "mock_in_pacb", kind: "INDIA_PAYOUT", country: "IN", jurisdiction: "IN",
    destCurrency: "INR", acceptsFiat: ["USD", "AED", "EUR", "GBP", "SGD"], rails: ["IMPS", "RTGS"], tokens: [], chains: [],
    spreadBps: 12, feeBps: 10, fixedFeeUsd: 0.5, etaSec: 4 * 3600, minUsd: 10, maxUsd: 29_000,
    kinds: ["BUSINESS"], indiaAuth: "PA_CB_E",
  },
  {
    id: "in.payout.mtss", partner: "mock_in_mtss", kind: "INDIA_PAYOUT", country: "IN", jurisdiction: "IN",
    destCurrency: "INR", acceptsFiat: ["USD", "AED", "EUR", "GBP", "SGD"], rails: ["IMPS", "UPI"], tokens: [], chains: [],
    spreadBps: 15, feeBps: 15, fixedFeeUsd: 0.5, etaSec: 15 * 60, minUsd: 5, maxUsd: 2_500,
    kinds: ["PERSONAL"], indiaAuth: "MTSS",
  },
  // ── India: outward, fiat only (no stablecoin on the Indian side) ─────────────
  {
    id: "in.outward.business", partner: "mock_in_out", kind: "DIRECT", country: "IN", jurisdiction: "IN",
    srcCurrency: "INR", destCurrencies: ["USD", "EUR", "GBP", "AED", "SGD"], rails: ["SWIFT_SAMEDAY"], tokens: [], chains: [],
    spreadBps: 20, feeBps: 15, fixedFeeUsd: 2, etaSec: 8 * 3600, minUsd: 10, maxUsd: 29_000,
    kinds: ["BUSINESS"], indiaAuth: "PA_CB_I",
  },
  {
    id: "in.outward.personal", partner: "mock_in_out", kind: "DIRECT", country: "IN", jurisdiction: "IN",
    srcCurrency: "INR", destCurrencies: ["USD", "EUR", "GBP", "AED", "SGD"], rails: ["SWIFT_SAMEDAY"], tokens: [], chains: [],
    spreadBps: 25, feeBps: 20, fixedFeeUsd: 2, etaSec: 12 * 3600, minUsd: 10, maxUsd: 250_000,
    kinds: ["PERSONAL"], indiaAuth: "LRS_AD",
  },
];

/** Approximate time for chain confirmation + partner detection, added once per stablecoin route. */
export const CHAIN_ETA_SEC: Record<string, number> = {
  solana: 20,
  base: 30,
  polygon: 60,
  tron: 90,
  ethereum: 180,
};

/** Estimated per-chain network fee in USD (paid by the partner, passed through at cost). */
export const CHAIN_FEE_USD: Record<string, number> = {
  solana: 0.01,
  base: 0.02,
  polygon: 0.02,
  tron: 1.0,
  ethereum: 2.5,
};

/** Token rules per jurisdiction. MiCA: USDT is not authorised for EU-licensed providers (since 1 Jul 2026). */
export const JURISDICTION_TOKEN_RULES: Record<string, { allowed: Array<"USDC" | "USDT"> }> = {
  EU: { allowed: ["USDC"] },
};

/** Every key partner gets a slightly pricier backup so routing can fail over (real life: sign 2+ partners per corridor). */
const BACKED_UP = ["mock_eu", "mock_uk", "mock_us", "mock_uae", "mock_sg", "mock_in_pacb", "mock_in_mtss"];

export const MOCK_LEGS: Leg[] = [
  ...PRIMARY_LEGS,
  ...PRIMARY_LEGS.filter(l => BACKED_UP.includes(l.partner)).map(l => ({
    ...l,
    id: `${l.id}.b`,
    partner: `${l.partner}_b`,
    feeBps: l.feeBps + 3,
    etaSec: Math.round(l.etaSec * 1.2),
  })),
];
