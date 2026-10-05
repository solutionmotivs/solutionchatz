// Guardrails: encode, in code, the legal lanes Vaulte operates in. A transfer that breaks a rule is
// refused before any money moves. This module is a safety net, NOT legal advice: limits come from
// public RBI/FEMA summaries (Oct 2026) and must be confirmed by counsel and the licensed partners.
import type { FundingMethodT, IndiaAuth, Token, TransferKindT } from "@/lib/stablecoin/types";
import { isHighRiskCountry, isSanctionedCountry } from "@/lib/compliance/aml";

export const LIMITS = {
  /** PA-CB: no single transaction above Rs 25 lakh. */
  PA_CB_MAX_INR: 2_500_000,
  /** MTSS inward personal remittance: USD 2,500 per transaction, 30 per calendar year per recipient. */
  MTSS_MAX_USD: 2_500,
  MTSS_MAX_COUNT_PER_YEAR: 30,
  /** LRS: USD 250,000 per resident individual per financial year (1 Apr - 31 Mar). */
  LRS_MAX_USD_PER_FY: 250_000,
  /** Internal risk cap for personal transfers outside India corridors (per transaction). */
  PERSONAL_MAX_USD: 10_000,
} as const;

export interface PartyCtx {
  verified: boolean;
  entityType: "BUSINESS" | "INDIVIDUAL";
  country: string;
  /** PAN verified by the partner during KYC (needed for LRS). Vaulte does not store the PAN. */
  panVerified?: boolean;
}

export interface GuardContext {
  kind: TransferKindT;
  originCountry: string;
  destCountry: string;
  amountUsd: number;
  /** Transfer value in INR when India is involved (for the PA-CB cap). */
  amountInr?: number;
  fundingMethod: FundingMethodT;
  usesStablecoin: boolean;
  token?: Token | null;
  /** Hard currency the Indian partner credits from; INR must always arrive as fiat. */
  payoutAssetIsFiat: boolean;
  purposeCode?: string | null;
  invoiceId?: string | null;
  sender: PartyCtx;
  recipient: PartyCtx;
  indiaAuths: IndiaAuth[];
  history: {
    recipientTransfersThisCalendarYear: number;
    senderUsdThisFinancialYear: number;
  };
}

export interface Violation {
  code: string;
  message: string;
}

export interface GuardResult {
  allowed: boolean;
  violations: Violation[];
  /** Soft flags that route the transfer to manual review but do not by themselves block it. */
  reviewFlags: string[];
}

const PURPOSE_CODE_RE = /^P\d{4}$/;

export function financialYearStart(d = new Date()): Date {
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return new Date(Date.UTC(y, 3, 1));
}

export function calendarYearStart(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
}

export function evaluateTransfer(ctx: GuardContext): GuardResult {
  const v: Violation[] = [];
  const flags: string[] = [];
  const add = (code: string, message: string) => v.push({ code, message });

  const indiaInvolved = ctx.originCountry === "IN" || ctx.destCountry === "IN";

  // Universal
  if (isSanctionedCountry(ctx.originCountry) || isSanctionedCountry(ctx.destCountry)) {
    add("SANCTIONED_COUNTRY", "Transfers to or from sanctioned jurisdictions are not allowed");
  }
  if (isHighRiskCountry(ctx.originCountry) || isHighRiskCountry(ctx.destCountry)) {
    flags.push("HIGH_RISK_COUNTRY");
  }
  if (!ctx.sender.verified) add("SENDER_NOT_VERIFIED", "Sender must complete KYB/KYC with the partner first");
  if (!ctx.recipient.verified) add("RECIPIENT_NOT_VERIFIED", "Recipient must complete KYB/KYC with the partner first");
  if (ctx.kind === "BUSINESS" && ctx.sender.entityType !== "BUSINESS") {
    add("KIND_MISMATCH", "Business transfers must be sent by a business entity");
  }
  if (ctx.kind === "PERSONAL" && (ctx.sender.entityType !== "INDIVIDUAL" || ctx.recipient.entityType !== "INDIVIDUAL")) {
    add("KIND_MISMATCH", "Personal transfers are between individuals");
  }

  // India must never be the origin or destination of crypto.
  if (ctx.originCountry === "IN" && (ctx.usesStablecoin || ctx.fundingMethod === "STABLECOIN")) {
    add("INDIA_ORIGIN_NO_CRYPTO", "Money originating in India must be sent as fiat; stablecoin funding is not allowed");
  }
  if (ctx.destCountry === "IN" && !ctx.payoutAssetIsFiat) {
    add("INDIA_DEST_FIAT_ONLY", "Recipients in India must be paid in INR through an authorised bank channel, never in crypto");
  }

  if (indiaInvolved) {
    if (ctx.kind === "BUSINESS") {
      if (!ctx.invoiceId) add("INVOICE_REQUIRED", "India business payments must be backed by an invoice");
      if (!ctx.purposeCode || !PURPOSE_CODE_RE.test(ctx.purposeCode)) {
        add("PURPOSE_CODE_REQUIRED", "A valid RBI purpose code (e.g. P0802) is required");
      }
      if (ctx.amountInr !== undefined && ctx.amountInr > LIMITS.PA_CB_MAX_INR) {
        add("ABOVE_PA_CB_CAP", "Above Rs 25 lakh per transaction: use an authorised-dealer bank wire (not instant)");
      }
      const need: IndiaAuth = ctx.destCountry === "IN" ? "PA_CB_E" : "PA_CB_I";
      if (!ctx.indiaAuths.includes(need)) {
        add("PARTNER_AUTH_MISSING", `Route must use a partner authorised for ${need}`);
      }
    } else {
      if (ctx.destCountry === "IN") {
        if (ctx.amountUsd > LIMITS.MTSS_MAX_USD) {
          add("ABOVE_MTSS_CAP", "Personal inward remittances are limited to USD 2,500 per transaction");
        }
        if (ctx.history.recipientTransfersThisCalendarYear >= LIMITS.MTSS_MAX_COUNT_PER_YEAR) {
          add("MTSS_COUNT_EXCEEDED", "Recipient has reached 30 personal remittances this calendar year");
        }
        if (!ctx.indiaAuths.includes("MTSS")) add("PARTNER_AUTH_MISSING", "Route must use an MTSS-authorised partner");
      } else {
        // India -> abroad (LRS)
        if (ctx.history.senderUsdThisFinancialYear + ctx.amountUsd > LIMITS.LRS_MAX_USD_PER_FY) {
          add("LRS_LIMIT_EXCEEDED", "Would exceed the USD 250,000 per financial year Liberalised Remittance limit");
        }
        if (!ctx.purposeCode) add("PURPOSE_CODE_REQUIRED", "A purpose is required for outward personal remittances");
        if (!ctx.sender.panVerified) add("PAN_REQUIRED", "Sender's PAN must be verified by the partner");
        if (!ctx.indiaAuths.includes("LRS_AD")) add("PARTNER_AUTH_MISSING", "Route must use an authorised-dealer bank partner");
      }
    }
  } else if (ctx.kind === "PERSONAL" && ctx.amountUsd > LIMITS.PERSONAL_MAX_USD) {
    add("ABOVE_PERSONAL_CAP", "Personal transfers are limited to USD 10,000 per transaction");
  }

  return { allowed: v.length === 0, violations: v, reviewFlags: flags };
}
