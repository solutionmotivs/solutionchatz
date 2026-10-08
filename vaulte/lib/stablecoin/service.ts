// Orchestration for stablecoin / fiat cross-border transfers.
// Vaulte never custodies funds: partners receive money, convert, and pay out. This service
// picks routes, enforces guardrails, keeps the memo ledger, and reacts to partner events.
import { flagsForInvoice, tradeReviewReason } from "@/lib/trade/transfer";
import { closedCountryList, currencyStatus, expOf } from "@/lib/currency";
import { buildTiming, type Timing } from "@/lib/routing/timing";
import { corridorTiming } from "@/lib/routing/settlement-metrics";
import { closedCountries } from "@/lib/routing/corridors";
import { onInvoicePaid as onEscrowInvoicePaid } from "@/lib/escrow/service";
import { tierLimits } from "@/lib/kyc/risk";
import { log } from "@/lib/log";
import { Prisma, type Entity, type Transfer } from "@prisma/client";
import { db } from "@/lib/db";
import { screenEntity } from "@/lib/compliance/aml";
import { screenWallet } from "@/lib/compliance/wallet";
import { addDocument, recordEfiraReference } from "@/lib/documents/service";
import { screenAndFlagEntity } from "@/lib/sanctions/entities";
import {
  calendarYearStart, evaluateTransfer, financialYearStart, type GuardContext, type GuardResult,
} from "@/lib/guardrails";
import { feeSplit } from "@/lib/pricing/split";
import { buildBreakdown, fromUsd, markupBpsFor, toUsd, validateMargin } from "@/lib/pricing";
import { buildLiveLegs, summariseFx, type LiveLegs } from "@/lib/fx/aggregator";
import { MOCK_LEGS } from "@/lib/routing/catalog";
import { realLegs } from "@/lib/routing/partners-config";
import { pickIndiaRail } from "@/lib/routing/india-rails";
import { applyAgentGate, agentRegistration, routeUsesVaulteAsAgent } from "@/lib/routing/structure";
import { onboardingFor, requireApprovedPartners, type PartnerOnboarding } from "@/lib/partners/customers";
import { findRoutes, nextRoute, pickAlternates, rankRoutes, routeCostUsd } from "@/lib/routing/engine";
import { bookFailureReversal, bookFundsReceived, bookPayout, finFromTransfer, rebookRevenue } from "@/lib/ledger/transfers";
import { getPartner } from "@/lib/psp/stablecoin/registry";
import { emitWebhookEvent } from "@/lib/webhooks/dispatch";
import { TOKEN_PEG } from "./types";
import type {
  CostBreakdown, FundingMethodT, Preference, Route, Token, TransferKindT,
} from "./types";
import { getRateTable } from "./rates";

const QUOTE_TTL_SEC = Number(process.env.QUOTE_TTL_SEC ?? 300);
const MAX_FAILOVERS = 3;
const VERIFICATION_ONLY = new Set(["SENDER_NOT_VERIFIED", "RECIPIENT_NOT_VERIFIED"]);
/** Not known at quote time: supplied when the transfer is created. They never block a quote, only the transfer. */
const DOCUMENT_ONLY = new Set(["INVOICE_REQUIRED", "PURPOSE_CODE_REQUIRED", "PAN_REQUIRED"]);
const ACTIVE_STATUSES = ["PENDING_VERIFICATION", "AWAITING_FUNDS", "FUNDS_DETECTED", "PAYING_OUT", "COMPLETED", "QUARANTINED"] as const;

export class ServiceError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) {
    super(message);
  }
}

export interface QuoteInput {
  kind: TransferKindT;
  senderEntityId: string;
  recipientEntityId: string;
  sourceCurrency: string;
  destCurrency: string;
  /** minor units of the source currency */
  sourceAmount: number;
  fundingMethod: FundingMethodT;
  token?: Token;
  prefer?: Preference;
}

const asJson = (v: unknown) => v as Prisma.InputJsonValue;

function lastLeg(route: Route) {
  return route.legs[route.legs.length - 1];
}

async function loadEntities(orgId: string, senderId: string, recipientId: string) {
  const [sender, recipient] = await Promise.all([
    db.entity.findFirst({ where: { id: senderId, organizationId: orgId } }),
    db.entity.findFirst({ where: { id: recipientId, organizationId: orgId } }),
  ]);
  if (!sender) throw new ServiceError("NOT_FOUND", "Sender entity not found", 404);
  if (!recipient) throw new ServiceError("NOT_FOUND", "Recipient entity not found", 404);
  return { sender, recipient };
}

/** Mock partners can only ever carry test-mode transfers. */
export function assertRouteMode(route: Route, sandbox: boolean) {
  if (!sandbox && route.legs.some(l => l.partner.startsWith("mock_"))) {
    throw new ServiceError("QUOTE_MODE_MISMATCH", "This quote was issued in test mode. Request a new quote for a live transfer.", 409);
  }
}

function partyCtx(e: Entity) {
  return {
    verified: e.verificationStatus === "APPROVED",
    entityType: (e.entityType === "INDIVIDUAL" ? "INDIVIDUAL" : "BUSINESS") as "BUSINESS" | "INDIVIDUAL",
    country: e.country,
    panVerified: e.panVerified,
    screening: e.screeningStatus,
  };
}

async function buildGuardContext(args: {
  kind: TransferKindT;
  sender: Entity;
  recipient: Entity;
  route: Route;
  fundingMethod: FundingMethodT;
  amountUsd: number;
  inrPerUsd?: number;
  purposeCode?: string | null;
  invoiceId?: string | null;
  excludeTransferId?: string;
}): Promise<GuardContext> {
  const { sender, recipient, route } = args;
  const since = (ms: number) => new Date(Date.now() - ms);
  const notSelf = args.excludeTransferId ? { id: { not: args.excludeTransferId } } : {};
  const [recipientCount, senderFy, sender24h, sender30d, tierCase] = await Promise.all([
    db.transfer.count({
      where: {
        recipientEntityId: recipient.id, kind: "PERSONAL", status: { in: [...ACTIVE_STATUSES] },
        createdAt: { gte: calendarYearStart() }, ...(args.excludeTransferId ? { id: { not: args.excludeTransferId } } : {}),
      },
    }),
    db.transfer.aggregate({
      where: {
        senderEntityId: sender.id, status: { in: [...ACTIVE_STATUSES] }, createdAt: { gte: financialYearStart() },
        ...(args.excludeTransferId ? { id: { not: args.excludeTransferId } } : {}),
      },
      _sum: { sourceAmountUsd: true },
    }),
    db.transfer.aggregate({ where: { senderEntityId: sender.id, status: { in: [...ACTIVE_STATUSES] }, createdAt: { gte: since(86_400_000) }, ...notSelf }, _sum: { sourceAmountUsd: true } }),
    db.transfer.aggregate({ where: { senderEntityId: sender.id, status: { in: [...ACTIVE_STATUSES] }, createdAt: { gte: since(30 * 86_400_000) }, ...notSelf }, _sum: { sourceAmountUsd: true } }),
    db.verificationCase.findFirst({ where: { entityId: sender.id, status: "APPROVED" }, orderBy: { decidedAt: "desc" }, select: { kind: true, tier: true } }),
  ]);
  const indiaInvolved = sender.country === "IN" || recipient.country === "IN";
  return {
    kind: args.kind,
    originCountry: sender.country,
    destCountry: recipient.country,
    amountUsd: args.amountUsd,
    amountInr: indiaInvolved && args.inrPerUsd ? args.amountUsd * args.inrPerUsd : undefined,
    fundingMethod: args.fundingMethod,
    usesStablecoin: route.usesStablecoin,
    token: route.token,
    payoutAssetIsFiat: ["OFFRAMP", "DIRECT", "INDIA_PAYOUT"].includes(lastLeg(route).kind),
    purposeCode: args.purposeCode ?? null,
    invoiceId: args.invoiceId ?? null,
    sender: { ...partyCtx(sender), limits: tierCase?.tier ? tierLimits(tierCase.kind as "KYB" | "KYC", tierCase.tier) : undefined },
    recipient: partyCtx(recipient),
    indiaAuths: route.legs.flatMap(l => (l.indiaAuth ? [l.indiaAuth] : [])),
    history: {
      recipientTransfersThisCalendarYear: recipientCount,
      senderUsdThisFinancialYear: Number(senderFy._sum.sourceAmountUsd ?? 0n) / 100,
      senderUsdLast24h: Number(sender24h._sum.sourceAmountUsd ?? 0n) / 100,
      senderUsdLast30d: Number(sender30d._sum.sourceAmountUsd ?? 0n) / 100,
    },
  };
}

function summariseRoute(r: Route) {
  return {
    id: r.id,
    partners: r.partners,
    token: r.token,
    chain: r.chain,
    legs: r.legs.map(l => ({ id: l.id, partner: l.partner, kind: l.kind, rails: l.rails, country: l.country })),
    eta_seconds: r.etaSec,
  };
}

// ── Quotes ───────────────────────────────────────────────────────────────────────

export interface BuiltQuote {
  routes: Route[];
  chosen: Route;
  breakdown: CostBreakdown;
  guard: GuardResult;
  sourceAmountUsd: number;
  destAmountMinor: number;
  sender: Entity;
  recipient: Entity;
  timing: Timing;
  /** Where the customer stands with each licensed partner on the chosen route. */
  partnerOnboarding: PartnerOnboarding[];
}

export async function evaluateQuote(orgId: string, input: QuoteInput, opts: { ignoreGuardrails?: boolean } = {}): Promise<BuiltQuote> {
  if (input.fundingMethod === "STABLECOIN") {
    // A stablecoin is priced in the currency it is redeemable for: USDC/USDT in USD, EURC in EUR.
    if (input.token && TOKEN_PEG[input.token] !== input.sourceCurrency) throw new ServiceError("INVALID_FUNDING", `${input.token} is priced in ${TOKEN_PEG[input.token]}; use source_currency ${TOKEN_PEG[input.token]}`, 400);
    if (!input.token && !["USD", "EUR"].includes(input.sourceCurrency)) throw new ServiceError("INVALID_FUNDING", "Stablecoin funding is priced in USD (USDC, USDT) or EUR (EURC); use source_currency USD or EUR", 400);
  }
  if (!Number.isInteger(input.sourceAmount) || input.sourceAmount <= 0) {
    throw new ServiceError("VALIDATION_ERROR", "source_amount must be a positive integer (minor units)", 400);
  }
  const { sender, recipient } = await loadEntities(orgId, input.senderEntityId, input.recipientEntityId);
  // Closed by default, in test mode too: a legal perimeter decision (sanctions), not something a customer or an API flag can open.
  const shut = [input.sourceCurrency, input.destCurrency].filter(c => currencyStatus(c) === "CLOSED");
  if (shut.length) throw new ServiceError("CURRENCY_CLOSED", `${Array.from(new Set(shut)).join(", ")} payments are not available. This currency is closed for legal reasons and is opened only after written legal clearance.`, 422);
  const shutCountries = [sender.country, recipient.country].map(c => c.toUpperCase()).filter(c => closedCountryList().has(c));
  if (shutCountries.length) throw new ServiceError("COUNTRY_CLOSED", `Payments to or from ${Array.from(new Set(shutCountries)).join(", ")} are not available. These countries are closed for legal reasons and are opened only after written legal clearance.`, 422);
  const rates = await getRateTable([input.sourceCurrency, input.destCurrency, "INR"]).catch(e => {
    throw new ServiceError("UNSUPPORTED_CURRENCY", e instanceof Error ? e.message : "Rate unavailable", 422);
  });
  const sourceAmountUsd = toUsd(input.sourceAmount, input.sourceCurrency, rates);
  // Business payers default to the route that lands today when one exists (cheapest among them); everyone can still ask for cheapest/fastest/balanced.
  const prefer = input.prefer ?? (input.kind === "BUSINESS" ? "same_day" : "balanced");

  // Test mode and live mode never mix: unverified accounts get the mock catalogue and sandbox providers only; approved accounts get
  // only the contracted partner catalogue (PARTNER_CATALOG_JSON) and live providers. No mock partner can ever carry live money.
  const orgRow = await db.organization.findUnique({ where: { id: orgId }, select: { kybStatus: true } });
  const sandbox = orgRow?.kybStatus !== "APPROVED";
  const closed = closedCountries(sender.country, recipient.country, sandbox);
  if (closed.length) throw new ServiceError("COUNTRY_NOT_ENABLED", `Live payments are not yet available for ${closed.join(", ")}. Test mode works everywhere; we open countries one by one after legal review.`, 422);
  const baseLegs = sandbox ? MOCK_LEGS : realLegs();
  // Live-priced FX providers (Airwallex, sandbox desks): each returns a firm rate that becomes a routable leg.
  const live = await buildLiveLegs({ sandbox,
    kind: input.kind, originCountry: sender.country, destCountry: recipient.country, sourceCurrency: input.sourceCurrency, destCurrency: input.destCurrency,
    sourceAmountMinor: input.sourceAmount, sourceAmountUsd, midDestPerSource: rates[input.destCurrency] / rates[input.sourceCurrency], fundingMethod: input.fundingMethod,
  }).catch(() => ({ legs: [], quotes: [], errors: [{ provider: "fx", error: "aggregator failed" }] }) as LiveLegs);
  const all = findRoutes({
    kind: input.kind, originCountry: sender.country, destCountry: recipient.country,
    sourceCurrency: input.sourceCurrency, destCurrency: input.destCurrency, amountUsd: sourceAmountUsd,
    fundingMethod: input.fundingMethod, token: input.token,
  }, { legs: [...baseLegs, ...live.legs] });
  if (!all.length) {
    throw new ServiceError("NO_ROUTE", "No compliant route is available for this corridor, amount and type", 422);
  }
  // Live only: routes where Vaulte acts as a partner's registered agent stay closed for a country until counsel has confirmed the registration there.
  const gated = sandbox ? { allowed: all, held: 0 } : applyAgentGate(all, sender.country);
  if (!gated.allowed.length) {
    throw new ServiceError("AGENT_REGISTRATION_REQUIRED", `Live payments for customers in ${sender.country} are not open yet: the agent registration with our licensed partner has not been confirmed for that country. Test mode works.`, 422);
  }
  const ranked = rankRoutes(gated.allowed, sourceAmountUsd, prefer, { destCountry: recipient.country });

  // Pick the best route that also passes the guardrails (the guardrails depend on the legs used).
  let chosen: Route | null = null;
  let guard: GuardResult = { allowed: false, violations: [], reviewFlags: [] };
  let firstGuard: GuardResult | null = null;
  for (const r of ranked) {
    const ctx = await buildGuardContext({
      kind: input.kind, sender, recipient, route: r, fundingMethod: input.fundingMethod,
      amountUsd: sourceAmountUsd, inrPerUsd: rates.INR,
    });
    const g = evaluateTransfer(ctx);
    firstGuard ??= g;
    const blocking = g.violations.filter(v => !VERIFICATION_ONLY.has(v.code) && !DOCUMENT_ONLY.has(v.code));
    if (blocking.length === 0 || opts.ignoreGuardrails) {
      chosen = r;
      guard = g;
      break;
    }
  }
  if (!chosen) {
    const hard = (firstGuard?.violations ?? []).filter(v => !VERIFICATION_ONLY.has(v.code) && !DOCUMENT_ONLY.has(v.code));
    throw new ServiceError("GUARDRAIL_VIOLATION", "This transfer is not allowed", 422, hard);
  }

  const markupBps = markupBpsFor(input.kind, sourceAmountUsd, undefined, { origin: sender.country, dest: recipient.country });
  const breakdown = buildBreakdown({
    route: chosen, kind: input.kind, sourceCurrency: input.sourceCurrency, destCurrency: input.destCurrency,
    sourceAmountMinor: input.sourceAmount, rates, markupBps,
  });
  const fx = summariseFx(chosen.legs.find(l => l.live), live, sourceAmountUsd);
  if (fx) breakdown.fx = fx;
  const margin = validateMargin(breakdown);
  if (!margin.ok) throw new ServiceError("PRICING_REJECTED", margin.reason ?? "Quote rejected", 422);

  const destAmountMinor = Math.floor(fromUsd(breakdown.destAmountUsd, input.destCurrency, rates) * 10 ** expOf(input.destCurrency));
  const measured = await corridorTiming(sender.country, recipient.country, sandbox).catch(() => null);
  const timing = buildTiming(chosen, recipient.country, measured);
  const partnerOnboarding = await onboardingFor(orgId, chosen, sandbox).catch(() => []);
  return { routes: ranked, chosen, breakdown, guard, sourceAmountUsd, destAmountMinor, sender, recipient, timing, partnerOnboarding };
}

export async function createQuote(orgId: string, input: QuoteInput) {
  const q = await evaluateQuote(orgId, input);
  const alternates = pickAlternates(q.routes, q.chosen);
  const expiresAt = new Date(Date.now() + QUOTE_TTL_SEC * 1000);
  const row = await db.quote.create({
    data: {
      expiresAt, kind: input.kind, senderEntityId: input.senderEntityId, recipientEntityId: input.recipientEntityId, originCountry: q.sender.country, destCountry: q.recipient.country,
      sourceCurrency: input.sourceCurrency, destCurrency: input.destCurrency, sourceAmount: BigInt(input.sourceAmount),
      destAmount: BigInt(q.destAmountMinor), fundingMethod: input.fundingMethod, prefer: input.prefer ?? (input.kind === "BUSINESS" ? "same_day" : "balanced"),
      route: asJson(q.chosen), alternates: asJson(alternates), breakdown: asJson(q.breakdown), organizationId: orgId,
    },
  });
  return { row, built: q };
}

export function serializeQuote(row: { id: string; expiresAt: Date; sourceCurrency: string; destCurrency: string; sourceAmount: bigint; destAmount: bigint; fundingMethod: string; kind: string }, built: BuiltQuote) {
  return {
    id: row.id,
    kind: row.kind,
    expires_at: row.expiresAt.toISOString(),
    source: { currency: row.sourceCurrency, amount: Number(row.sourceAmount), country: built.sender.country },
    destination: { currency: row.destCurrency, amount: Number(row.destAmount), country: built.recipient.country },
    funding_method: row.fundingMethod,
    route: summariseRoute(built.chosen),
    estimated_arrival_seconds: built.chosen.etaSec,
    ...(row.destCurrency === "INR" ? { payout_rail: pickIndiaRail(Number(row.destAmount) / 100, lastLeg(built.chosen).rails) } : {}),
    timing: built.timing,
    breakdown: built.breakdown,
    fees: feeSplit(built.breakdown),
    partner_onboarding: built.partnerOnboarding,
    review_flags: built.guard.reviewFlags,
    verification_pending: built.guard.violations.filter(v => VERIFICATION_ONLY.has(v.code)).map(v => v.code),
    documents_required: built.guard.violations.filter(v => DOCUMENT_ONLY.has(v.code)).map(v => v.code),
    note: "Rates are firm until expires_at. Vaulte does not hold funds; the licensed partner executes the transfer.",
  };
}

// ── Transfers ────────────────────────────────────────────────────────────────────

export interface CreateTransferInput {
  quoteId: string;
  purposeCode?: string;
  invoiceId?: string;
  idempotencyKey?: string;
  description?: string;
  isSandbox?: boolean;
}

const cents = (usd: number) => BigInt(Math.round(usd * 100));

export async function createTransferFromQuote(orgId: string, input: CreateTransferInput): Promise<Transfer> {
  if (input.idempotencyKey) {
    const existing = await db.transfer.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.organizationId !== orgId) throw new ServiceError("CONFLICT", "Idempotency key already used", 409);
      return existing;
    }
  }
  const quote = await db.quote.findFirst({ where: { id: input.quoteId, organizationId: orgId } });
  if (!quote) throw new ServiceError("NOT_FOUND", "Quote not found", 404);
  if (quote.status !== "ACTIVE") throw new ServiceError("QUOTE_USED", "Quote already used or expired", 409);
  if (quote.expiresAt.getTime() < Date.now()) {
    await db.quote.update({ where: { id: quote.id }, data: { status: "EXPIRED" } });
    throw new ServiceError("QUOTE_EXPIRED", "Quote expired; request a new one", 409);
  }

  const route = quote.route as unknown as Route;
  const breakdown = quote.breakdown as unknown as CostBreakdown;
  const { sender, recipient } = await loadEntities(orgId, quote.senderEntityId, quote.recipientEntityId);

  // Mode is decided by the account's verification, never by the caller. A quote issued in test mode cannot become a live transfer.
  const orgNow = await db.organization.findUnique({ where: { id: orgId }, select: { kybStatus: true } });
  const sandboxNow = orgNow?.kybStatus !== "APPROVED";
  assertRouteMode(route, sandboxNow);
  const closedNow = closedCountries(sender.country, recipient.country, sandboxNow);
  if (closedNow.length) throw new ServiceError("COUNTRY_NOT_ENABLED", `Live payments are not yet available for ${closedNow.join(", ")}.`, 422);
  if (!sandboxNow && routeUsesVaulteAsAgent(route) && agentRegistration(sender.country) === "missing") {
    throw new ServiceError("AGENT_REGISTRATION_REQUIRED", `Live payments for customers in ${sender.country} are not open yet: the agent registration with our licensed partner has not been confirmed for that country.`, 422);
  }
  // The licensed partner is the provider of record: it must have approved this customer (Vaulte sends the verified KYB package) before live money moves.
  await requireApprovedPartners(orgId, route, sandboxNow);

  // Screen both parties again at transfer time (lists change daily); a hit flips their status, which the guardrails then enforce.
  await screenAndFlagEntity(sender, "TRANSFER_PARTY");
  await screenAndFlagEntity(recipient, "TRANSFER_PARTY");
  const [senderNow, recipientNow] = await Promise.all([db.entity.findUniqueOrThrow({ where: { id: sender.id } }), db.entity.findUniqueOrThrow({ where: { id: recipient.id } })]);

  // Re-run guardrails with the real documents and the up-to-date verification state.
  const ctx = await buildGuardContext({
    kind: quote.kind, sender: senderNow, recipient: recipientNow, route, fundingMethod: quote.fundingMethod,
    amountUsd: breakdown.sourceAmountUsd, inrPerUsd: breakdown.destCurrency === "INR" ? breakdown.midRateDestPerUsd : breakdown.sourceCurrency === "INR" ? breakdown.midRateSourcePerUsd : undefined,
    purposeCode: input.purposeCode, invoiceId: input.invoiceId,
  });
  const guard = evaluateTransfer(ctx);
  const blocking = guard.violations.filter(v => !VERIFICATION_ONLY.has(v.code));
  if (blocking.length) throw new ServiceError("GUARDRAIL_VIOLATION", "This transfer is not allowed", 422, blocking);
  const prohibitedGoods = (await flagsForInvoice(input.invoiceId)).find(f => f.severity === "PROHIBITED");
  if (prohibitedGoods) throw new ServiceError("HS_PROHIBITED", prohibitedGoods.reason, 422);

  // Claim the quote atomically so two requests cannot use it twice.
  const claimed = await db.quote.updateMany({ where: { id: quote.id, status: "ACTIVE" }, data: { status: "USED" } });
  if (claimed.count !== 1) throw new ServiceError("QUOTE_USED", "Quote already used", 409);

  const needsVerification = guard.violations.length > 0;
  const partnerCostUsd = cents(breakdown.partnerCostUsd);
  const markupUsd = cents(breakdown.markupUsd);
  const transfer = await db.transfer.create({
    data: {
      kind: quote.kind,
      status: needsVerification ? "PENDING_VERIFICATION" : "AWAITING_FUNDS",
      statusReason: needsVerification ? guard.violations.map(v => v.code).join(",") : null,
      fundingMethod: quote.fundingMethod,
      isSandbox: sandboxNow,
      originCountry: quote.originCountry, destCountry: quote.destCountry,
      sourceCurrency: quote.sourceCurrency, destCurrency: quote.destCurrency,
      sourceAmount: quote.sourceAmount, destAmount: quote.destAmount,
      sourceAmountUsd: cents(breakdown.sourceAmountUsd),
      markupBps: breakdown.markupBps, markupUsd, partnerCostUsd,
      quotedFeesUsd: partnerCostUsd + markupUsd,
      token: route.token, chain: route.chain,
      route: asJson(route), alternates: quote.alternates as Prisma.InputJsonValue,
      purposeCode: input.purposeCode ?? null, invoiceId: input.invoiceId ?? null,
      idempotencyKey: input.idempotencyKey ?? null, description: input.description ?? null,
      organizationId: orgId, quoteId: quote.id, senderEntityId: sender.id, recipientEntityId: recipient.id,
    },
  });
  await db.auditLog.create({
    data: { action: "transfer.created", resourceType: "Transfer", resourceId: transfer.id, organizationId: orgId, metadata: { kind: quote.kind, status: transfer.status } },
  });
  await emitWebhookEvent({ organizationId: orgId, event: "transfer.created", data: { transfer_id: transfer.id, status: transfer.status } });
  if (!needsVerification) return issueFunding(transfer.id);
  return transfer;
}

/** Ask the funding partner for deposit / bank details. Called once parties are verified. */
export async function issueFunding(transferId: string): Promise<Transfer> {
  const t = await db.transfer.findUniqueOrThrow({ where: { id: transferId } });
  if (t.fundingMethod === "VIRTUAL_ACCOUNT") return t;
  const route = t.route as unknown as Route;
  assertRouteMode(route, t.isSandbox);
  const partner = getPartner(route.legs[0].partner);
  let instructions: Record<string, unknown>;
  if (t.fundingMethod === "STABLECOIN") {
    const token = route.token as Token;
    const chain = route.chain!;
    const expectedMicro = BigInt(Math.round(Number(t.sourceAmount) * 10_000)); // 1 token = 1 unit of its peg (USD or EUR) = the source currency; 6 decimals
    const dep = await partner.createDeposit({ transferId: t.id, token, chain, expectedAmountMicro: expectedMicro });
    await db.stablecoinDeposit.create({
      data: {
        partner: partner.id, partnerRef: dep.partnerRef, token, chain, address: dep.address,
        expectedAmount: expectedMicro, expiresAt: dep.expiresAt, transferId: t.id,
      },
    });
    instructions = {
      type: "STABLECOIN", token, chain, address: dep.address, memo: dep.memo ?? null,
      amount_token: (Number(expectedMicro) / 1_000_000).toFixed(2), expires_at: dep.expiresAt.toISOString(),
      warning: `Send only ${token} on ${chain} to this address. Funds sent on another network may be lost.`,
    };
  } else {
    const f = await partner.createFiatFunding({ transferId: t.id, currency: t.sourceCurrency, amountMinor: t.sourceAmount });
    instructions = { type: "FIAT", currency: t.sourceCurrency, amount: Number(t.sourceAmount), reference: f.reference, bank_details: f.bankDetails };
  }
  return db.transfer.update({
    where: { id: t.id },
    data: { status: "AWAITING_FUNDS", statusReason: null, fundingInstructions: asJson(instructions) },
  });
}

/** After a party is verified, release any transfers that were only waiting for that. */
export async function activatePendingTransfers(entityId: string): Promise<number> {
  const pending = await db.transfer.findMany({
    where: { status: "PENDING_VERIFICATION", OR: [{ senderEntityId: entityId }, { recipientEntityId: entityId }] },
    include: { sender: true, recipient: true },
  });
  let activated = 0;
  for (const t of pending) {
    if (t.sender.verificationStatus !== "APPROVED" || t.recipient.verificationStatus !== "APPROVED") continue;
    const route = t.route as unknown as Route;
    const ctx = await buildGuardContext({
      kind: t.kind, sender: t.sender, recipient: t.recipient, route, fundingMethod: t.fundingMethod,
      amountUsd: Number(t.sourceAmountUsd) / 100, purposeCode: t.purposeCode, invoiceId: t.invoiceId, excludeTransferId: t.id,
      inrPerUsd: (await getRateTable(["INR"]).catch(() => ({ INR: undefined as unknown as number }))).INR,
    });
    if (evaluateTransfer(ctx).allowed) {
      await issueFunding(t.id);
      activated++;
    }
  }
  return activated;
}

// ── Funds received, payout, completion, failover ─────────────────────────────────

/** Called when the partner confirms the sender's money arrived. Runs checks, books the ledger, starts the payout. */
async function onFundsConfirmed(transferId: string, opts: { receivedMicro?: bigint; fromAddress?: string; depositId?: string }) {
  const t = await db.transfer.findUniqueOrThrow({ where: { id: transferId } });
  if (t.status !== "AWAITING_FUNDS" && t.status !== "QUARANTINED") return t; // already progressed (idempotent)

  if (opts.fromAddress) {
    const w = await screenWallet(opts.fromAddress, { organizationId: t.organizationId, subjectId: t.id });
    if (!w.cleared) return quarantine(t.id, `SANCTIONS_REVIEW: ${w.reason ?? "wallet flagged"}`, true);
  }
  if (opts.receivedMicro !== undefined && opts.depositId) {
    const dep = await db.stablecoinDeposit.findUniqueOrThrow({ where: { id: opts.depositId } });
    if (opts.receivedMicro < dep.expectedAmount) {
      await db.stablecoinDeposit.update({ where: { id: dep.id }, data: { status: "UNDERPAID", receivedAmount: opts.receivedMicro } });
      return quarantine(t.id, "UNDERPAID: received less than the quoted amount; partner will refund or top up", true);
    }
    await db.stablecoinDeposit.update({ where: { id: dep.id }, data: { status: "CONFIRMED", receivedAmount: opts.receivedMicro } });
  }

  // Goods that need a second pair of eyes (precious metals, dual-use, chemicals...) are held after the funds are confirmed and before any payout.
  const tradeHold = await tradeReviewReason(t.id, t.invoiceId);
  if (tradeHold) return quarantine(t.id, tradeHold, true);

  await db.$transaction(async tx => {
    await tx.transfer.update({ where: { id: t.id }, data: { status: "FUNDS_DETECTED", statusReason: null, fundedAt: t.fundedAt ?? new Date() } });
    await bookFundsReceived(tx, finFromTransfer(t));
  });
  await emitWebhookEvent({ organizationId: t.organizationId, event: "transfer.funded", data: { transfer_id: t.id } });
  return dispatchPayout(t.id);
}

async function quarantine(transferId: string, reason: string, fundsKnown: boolean): Promise<Transfer> {
  const t = await db.transfer.update({
    where: { id: transferId },
    data: {
      status: "QUARANTINED", statusReason: reason,
      ...(fundsKnown ? { fundingInstructions: asJson({ ...(((await db.transfer.findUnique({ where: { id: transferId }, select: { fundingInstructions: true } }))?.fundingInstructions as object) ?? {}), fundsConfirmed: true }) } : {}),
    },
  });
  await emitWebhookEvent({ organizationId: t.organizationId, event: "compliance.flagged", data: { transfer_id: t.id, reason } });
  return t;
}

export async function dispatchPayout(transferId: string): Promise<Transfer> {
  const t = await db.transfer.findUniqueOrThrow({ where: { id: transferId }, include: { recipient: true } });
  const route = t.route as unknown as Route;
  const leg = lastLeg(route);
  try {
    assertRouteMode(route, t.isSandbox);
    const invoice = t.invoiceId ? await db.invoice.findUnique({ where: { id: t.invoiceId }, select: { number: true } }) : null;
    const bank = await db.bankAccount.findFirst({ where: { entityId: t.recipientEntityId, currency: t.destCurrency }, orderBy: [{ isVerified: "desc" }, { createdAt: "desc" }] });
    const res = await getPartner(leg.partner).createPayout({
      beneficiary: bank ? {
        accountName: bank.accountName, entityType: t.recipient.entityType === "INDIVIDUAL" ? "PERSONAL" : "COMPANY", bankCountry: bank.country, currency: bank.currency,
        iban: bank.iban ?? undefined, swiftBic: bank.swiftBic ?? undefined, accountNumber: bank.accountNumber ?? undefined, routingNumber: bank.routingNumber ?? undefined, sortCode: bank.sortCode ?? undefined,
        ifsc: bank.ifsc ?? undefined, upiId: bank.upiId ?? undefined,
      } : undefined,
      rail: t.destCurrency === "INR" ? pickIndiaRail(Number(t.destAmount) / 100, leg.rails, { hasUpiId: !!bank?.upiId }).rail : undefined,
      transferId: t.id, route, destCurrency: t.destCurrency, destAmountMinor: t.destAmount,
      recipientName: t.recipient.legalName, recipientCountry: t.recipient.country,
      purposeCode: t.purposeCode, invoiceNumber: invoice?.number ?? null,
    });
    return db.transfer.update({ where: { id: t.id }, data: { status: "PAYING_OUT", externalRef: res.partnerRef } });
  } catch (e) {
    return handlePayoutFailure(t.id, e instanceof Error ? e.message : "payout dispatch failed");
  }
}

/** Fail over to another payout partner (same funding partner), or fail and reverse the ledger. */
export async function handlePayoutFailure(transferId: string, reason: string): Promise<Transfer> {
  const t = await db.transfer.findUniqueOrThrow({ where: { id: transferId } });
  const route = t.route as unknown as Route;
  const alternates = (t.alternates as unknown as Route[]) ?? [];
  const failedPartner = lastLeg(route).partner;
  const sameFunding = alternates.filter(r => r.legs[0].partner === route.legs[0].partner);
  const next = t.routeIndex < MAX_FAILOVERS ? nextRoute(rankRoutes(sameFunding, Number(t.sourceAmountUsd) / 100, "cheapest"), [failedPartner]) : null;

  if (next) {
    // Customer keeps the quoted amount; if the new partner costs more, Vaulte's markup absorbs it.
    const newCost = cents(routeCostUsd(next, Number(t.sourceAmountUsd) / 100));
    const oldMarkup = t.markupUsd;
    const oldCost = t.partnerCostUsd;
    const newMarkup = t.quotedFeesUsd - newCost;
    await db.$transaction(async tx => {
      // Re-book the fee split so Vaulte's revenue matches reality (total fees charged to the customer are unchanged).
      await rebookRevenue(tx, finFromTransfer({ ...t, partnerCostUsd: newCost, markupUsd: newMarkup }));
      await tx.transfer.update({
        where: { id: t.id },
        data: {
          route: asJson(next), alternates: asJson(alternates.filter(r => r.id !== next.id)), routeIndex: { increment: 1 },
          partnerCostUsd: newCost, markupUsd: newMarkup, status: "FUNDS_DETECTED", statusReason: `FAILOVER from ${failedPartner}: ${reason}`,
        },
      });
    });
    return dispatchPayout(t.id);
  }

  // No alternative: fail and reverse everything booked so far (partner refunds the sender).
  return db.$transaction(async tx => {
    // Reverse the NET position of the transfer in one journal (earlier fee re-bookings from failovers are already included).
    await bookFailureReversal(tx, t);
    const failed = await tx.transfer.update({ where: { id: t.id }, data: { status: "FAILED", statusReason: reason } });
    await tx.auditLog.create({ data: { action: "transfer.failed", resourceType: "Transfer", resourceId: t.id, organizationId: t.organizationId, metadata: { reason } } });
    return failed;
  }).then(async failed => {
    await emitWebhookEvent({ organizationId: failed.organizationId, event: "transfer.failed", data: { transfer_id: failed.id, reason } });
    return failed;
  });
}

async function onPayoutCompleted(transferId: string, efiraRef?: string | null): Promise<Transfer> {
  const t = await db.transfer.findUniqueOrThrow({ where: { id: transferId } });
  if (t.status === "COMPLETED") return t;
  if (t.status !== "PAYING_OUT") return t;
  const done = await db.$transaction(async tx => {
    await bookPayout(tx, finFromTransfer(t));
    if (t.invoiceId) {
      await tx.invoice.updateMany({ where: { id: t.invoiceId, status: { not: "PAID" } }, data: { status: "PAID", paidAt: new Date() } });
    }
    return tx.transfer.update({ where: { id: t.id }, data: { status: "COMPLETED", completedAt: new Date(), efiraRef: efiraRef ?? t.efiraRef, statusReason: null } });
  });
  await recordEfiraReference(done, done.efiraRef).catch(e => log("error", "efira record failed", { error: e }));
  await emitWebhookEvent({ organizationId: t.organizationId, event: "transfer.completed", data: { transfer_id: t.id, efira_ref: done.efiraRef } });
  if (t.invoiceId) {
    const inv = await db.invoice.findUnique({ where: { id: t.invoiceId }, select: { number: true, reference: true, source: true } });
    await emitWebhookEvent({ organizationId: t.organizationId, event: "invoice.paid", data: { invoice_id: t.invoiceId, transfer_id: t.id, number: inv?.number ?? null, reference: inv?.reference ?? null, source: inv?.source ?? null } });
    // Milestone deals billed through this invoice move on (no-op for ordinary invoices).
    await onEscrowInvoicePaid(t.invoiceId).catch(e => log("error", "escrow invoice hook failed", { error: e }));
  }
  return done;
}

// ── Staff review of held transfers ───────────────────────────────────────────────

export async function reviewTransfer(transferId: string, decision: "RELEASE" | "REJECT", note?: string): Promise<Transfer> {
  const t = await db.transfer.findUniqueOrThrow({ where: { id: transferId } });
  if (t.status !== "QUARANTINED") throw new ServiceError("INVALID_STATE", "Transfer is not on hold", 409);
  const funded = Boolean((t.fundingInstructions as { fundsConfirmed?: boolean } | null)?.fundsConfirmed);
  await db.auditLog.create({ data: { action: `transfer.review.${decision.toLowerCase()}`, resourceType: "Transfer", resourceId: t.id, organizationId: t.organizationId, metadata: { note: note ?? null } } });
  if (decision === "REJECT") {
    // Funds (if any) are returned to the sender by the partner; nothing was booked in the memo ledger yet.
    return db.transfer.update({ where: { id: t.id }, data: { status: "CANCELLED", statusReason: `REJECTED: ${note ?? "by staff"}` } });
  }
  if (!funded) throw new ServiceError("NO_FUNDS", "Cannot release: funds not confirmed by the partner", 409);
  return onFundsConfirmed(t.id, {});
}

/** Customer supplies missing documents (purpose code / invoice) for a held transfer. */
export async function attachDocuments(orgId: string, transferId: string, docs: { purposeCode?: string; invoiceId?: string }): Promise<Transfer> {
  const t = await db.transfer.findFirst({ where: { id: transferId, organizationId: orgId }, include: { sender: true, recipient: true } });
  if (!t) throw new ServiceError("NOT_FOUND", "Transfer not found", 404);
  if (t.status !== "QUARANTINED" && t.status !== "AWAITING_FUNDS" && t.status !== "PENDING_VERIFICATION") {
    throw new ServiceError("INVALID_STATE", "Documents can only be attached before the payout starts", 409);
  }
  if (docs.invoiceId) {
    const inv = await db.invoice.findFirst({ where: { id: docs.invoiceId, organizationId: orgId } });
    if (!inv) throw new ServiceError("NOT_FOUND", "Invoice not found", 404, { param: "invoice_id" });
  }
  const route = t.route as unknown as Route;
  const rates = await getRateTable(["INR"]).catch(() => ({ INR: undefined as unknown as number }));
  const ctx = await buildGuardContext({
    kind: t.kind, sender: t.sender, recipient: t.recipient, route, fundingMethod: t.fundingMethod,
    amountUsd: Number(t.sourceAmountUsd) / 100, inrPerUsd: rates.INR, excludeTransferId: t.id,
    purposeCode: docs.purposeCode ?? t.purposeCode, invoiceId: docs.invoiceId ?? t.invoiceId,
  });
  const g = evaluateTransfer(ctx);
  const blocking = g.violations.filter(v => !VERIFICATION_ONLY.has(v.code));
  const updated = await db.transfer.update({
    where: { id: t.id },
    data: { purposeCode: docs.purposeCode ?? t.purposeCode, invoiceId: docs.invoiceId ?? t.invoiceId },
  });
  if (blocking.length) throw new ServiceError("GUARDRAIL_VIOLATION", "Still missing required information", 422, blocking);
  const funded = Boolean((t.fundingInstructions as { fundsConfirmed?: boolean } | null)?.fundsConfirmed);
  if (updated.status === "QUARANTINED" && funded && String(updated.statusReason).startsWith("DOCUMENTS_REQUIRED")) {
    return onFundsConfirmed(updated.id, {});
  }
  return updated;
}

// ── Partner webhook events ───────────────────────────────────────────────────────

export interface PartnerEventInput {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export async function processPartnerEvent(partnerId: string, ev: PartnerEventInput): Promise<"processed" | "duplicate" | "ignored"> {
  try {
    await db.partnerEvent.create({ data: { partner: partnerId, externalId: ev.id, type: ev.type, payload: asJson(ev.data) } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "duplicate";
    throw e;
  }
  try {
    const handled = await routeEvent(partnerId, ev);
    await db.partnerEvent.update({ where: { partner_externalId: { partner: partnerId, externalId: ev.id } }, data: { processedAt: new Date() } });
    return handled ? "processed" : "ignored";
  } catch (e) {
    // Let the partner retry: remove the idempotency record so the redelivery is processed again.
    await db.partnerEvent.delete({ where: { partner_externalId: { partner: partnerId, externalId: ev.id } } }).catch(() => {});
    throw e;
  }
}

/** Partners reference our transfer either by our id or by the id they gave us when the payout was created. */
async function findTransferForEvent(d: Record<string, any>) {
  if (d.transfer_id) return db.transfer.findUnique({ where: { id: String(d.transfer_id) } });
  if (d.transfer_ref) return db.transfer.findFirst({ where: { externalRef: String(d.transfer_ref) } });
  return null;
}

async function routeEvent(partnerId: string, ev: PartnerEventInput): Promise<boolean> {
  const d = ev.data as Record<string, any>;
  switch (ev.type) {
    case "deposit.detected": {
      const dep = await db.stablecoinDeposit.findUnique({ where: { address: String(d.address) } });
      if (!dep) return false;
      await db.stablecoinDeposit.updateMany({ where: { id: dep.id, status: "AWAITING" }, data: { status: "DETECTED", txHash: d.tx_hash ?? null, confirmations: Number(d.confirmations ?? 0) } });
      return true;
    }
    case "deposit.confirmed": {
      const dep = await db.stablecoinDeposit.findUnique({ where: { address: String(d.address) } });
      if (!dep) return false;
      await db.stablecoinDeposit.update({ where: { id: dep.id }, data: { txHash: d.tx_hash ?? dep.txHash, confirmations: Number(d.confirmations ?? 1) } });
      await onFundsConfirmed(dep.transferId, { receivedMicro: BigInt(String(d.amount_micro)), fromAddress: d.from_address, depositId: dep.id });
      return true;
    }
    case "fiat.received": {
      const t = await db.transfer.findUnique({ where: { id: String(d.reference) } });
      if (!t || t.fundingMethod !== "FIAT_LOCAL") return false;
      if (BigInt(String(d.amount)) < t.sourceAmount) {
        await quarantine(t.id, "UNDERPAID: received less than the quoted amount; partner will refund or top up", true);
        return true;
      }
      await onFundsConfirmed(t.id, {});
      return true;
    }
    case "payout.completed": {
      const t = await findTransferForEvent(d);
      if (!t) return false;
      await onPayoutCompleted(t.id, d.efira_ref ?? null);
      return true;
    }
    case "payout.failed": {
      const t = await findTransferForEvent(d);
      if (!t || t.status !== "PAYING_OUT") return false;
      await handlePayoutFailure(t.id, String(d.reason ?? "partner payout failed"));
      return true;
    }
    case "document.issued": {
      // A licensed partner/bank delivers a certificate (eFIRA, FIRC, eBRC, ...) for a transfer. The signature already proved the sender.
      const t = await findTransferForEvent(d);
      if (!t) return false;
      let file: { data: Buffer; name: string } | undefined;
      if (typeof d.content_base64 === "string" && d.content_base64.length <= 11_500_000) file = { data: Buffer.from(d.content_base64, "base64"), name: String(d.filename ?? "certificate.pdf") };
      await addDocument({ organizationId: t.organizationId, transferId: t.id, type: String(d.type ?? "OTHER").toUpperCase(), number: d.number ? String(d.number) : null, issuer: String(d.issuer ?? partnerId), issuedOn: d.issued_on ? String(d.issued_on) : null, refs: d.refs && typeof d.refs === "object" ? Object.fromEntries(Object.entries(d.refs as Record<string, unknown>).map(([k, v]) => [k, String(v)])) : {}, source: "PARTNER", file, status: "VERIFIED" });
      if (String(d.type).toUpperCase() === "EFIRA" && d.number && !t.efiraRef) await db.transfer.update({ where: { id: t.id }, data: { efiraRef: String(d.number) } });
      return true;
    }
    case "virtual_account.credit":
      return onVirtualAccountCredit(partnerId, d);
    default:
      return false;
  }
}

async function onVirtualAccountCredit(partnerId: string, d: Record<string, any>): Promise<boolean> {
  const va = await db.virtualAccount.findUnique({ where: { partner_partnerRef: { partner: partnerId, partnerRef: String(d.partner_ref) } }, include: { entity: true } });
  if (!va) return false;
  const amount = Number(d.amount);
  const currency = String(d.currency ?? va.currency);
  const rule = va.sweepRule as { destCurrency: string; recipientEntityId?: string; defaultPurposeCode?: string };

  // Payer is recorded as a counterparty entity owned by the account holder's organization.
  const payer = await db.entity.create({
    data: {
      legalName: String(d.sender_name ?? "Unknown payer"), country: String(d.sender_country ?? va.country), currency,
      entityType: va.entity.entityType, organizationId: va.organizationId,
      // The partner screened the payer when crediting the account; Vaulte records their assertion.
      verificationStatus: d.payer_verified ? "APPROVED" : "NOT_STARTED", isVerified: Boolean(d.payer_verified),
      isSandbox: va.entity.isSandbox,
    },
  });
  const recipientId = rule.recipientEntityId ?? va.entityId;
  const input: QuoteInput = {
    kind: va.entity.entityType === "INDIVIDUAL" ? "PERSONAL" : "BUSINESS", senderEntityId: payer.id, recipientEntityId: recipientId,
    sourceCurrency: currency, destCurrency: rule.destCurrency, sourceAmount: amount, fundingMethod: "VIRTUAL_ACCOUNT", prefer: "balanced",
  };
  const sanctions = await screenEntity(payer.legalName, payer.country, { organizationId: va.organizationId, subjectType: "VA_PAYER", subjectId: payer.id, kind: payer.entityType === "INDIVIDUAL" ? "INDIVIDUAL" : "ENTITY" });
  let held: string | null = sanctions.cleared ? null : `SANCTIONS_REVIEW: payer ${payer.legalName} matched screening`;

  let built: BuiltQuote;
  try {
    built = await evaluateQuote(va.organizationId, input, { ignoreGuardrails: true });
  } catch (e) {
    throw e; // no route / pricing problem: surface to the partner for retry/manual handling
  }
  const route = built.chosen;
  const ctx = await buildGuardContext({
    kind: input.kind, sender: payer, recipient: built.recipient, route, fundingMethod: "VIRTUAL_ACCOUNT",
    amountUsd: built.sourceAmountUsd, inrPerUsd: built.breakdown.destCurrency === "INR" ? built.breakdown.midRateDestPerUsd : undefined,
    purposeCode: rule.defaultPurposeCode ?? null, invoiceId: null,
  });
  const guard = evaluateTransfer(ctx);
  if (!held && guard.violations.length) {
    const codes = guard.violations.map(v => v.code);
    const docs = codes.every(c => c === "INVOICE_REQUIRED" || c === "PURPOSE_CODE_REQUIRED");
    held = docs ? `DOCUMENTS_REQUIRED: ${codes.join(",")}` : `GUARDRAIL: ${codes.join(",")}`;
  }

  const alternates = pickAlternates(built.routes, route);
  const quote = await db.quote.create({
    data: {
      expiresAt: new Date(Date.now() + QUOTE_TTL_SEC * 1000), status: "USED", kind: input.kind,
      senderEntityId: payer.id, recipientEntityId: recipientId, originCountry: payer.country, destCountry: built.recipient.country,
      sourceCurrency: currency, destCurrency: rule.destCurrency, sourceAmount: BigInt(amount), destAmount: BigInt(built.destAmountMinor),
      fundingMethod: "VIRTUAL_ACCOUNT", route: asJson(route), alternates: asJson(alternates), breakdown: asJson(built.breakdown),
      organizationId: va.organizationId,
    },
  });
  const partnerCostUsd = cents(built.breakdown.partnerCostUsd);
  const markupUsd = cents(built.breakdown.markupUsd);
  const transfer = await db.transfer.create({
    data: {
      kind: input.kind, status: "AWAITING_FUNDS", fundingMethod: "VIRTUAL_ACCOUNT", isSandbox: va.entity.isSandbox,
      originCountry: payer.country, destCountry: built.recipient.country, sourceCurrency: currency, destCurrency: rule.destCurrency,
      sourceAmount: BigInt(amount), destAmount: BigInt(built.destAmountMinor), sourceAmountUsd: cents(built.breakdown.sourceAmountUsd),
      markupBps: built.breakdown.markupBps, markupUsd, partnerCostUsd, quotedFeesUsd: partnerCostUsd + markupUsd,
      token: route.token, chain: route.chain, route: asJson(route), alternates: asJson(alternates),
      purposeCode: rule.defaultPurposeCode ?? null, organizationId: va.organizationId, quoteId: quote.id,
      senderEntityId: payer.id, recipientEntityId: recipientId,
      fundingInstructions: asJson({ type: "VIRTUAL_ACCOUNT", virtual_account_id: va.id, reference: d.reference ?? null }),
    },
  });
  await emitWebhookEvent({ organizationId: va.organizationId, event: "virtual_account.credited", data: { virtual_account_id: va.id, transfer_id: transfer.id, amount, currency } });
  if (held) {
    await quarantine(transfer.id, held, true);
    return true;
  }
  await onFundsConfirmed(transfer.id, {});
  return true;
}

/**
 * Quote so that the RECIPIENT receives (about) a fixed destination amount: used for invoice payments,
 * where the payer must cover fees. Iterates the forward quote a few times (fees depend on the amount).
 */
export async function createQuoteForDestination(
  orgId: string,
  input: Omit<QuoteInput, "sourceAmount"> & { destAmount: number },
) {
  const rates = await getRateTable([input.sourceCurrency, input.destCurrency]).catch(e => {
    throw new ServiceError("UNSUPPORTED_CURRENCY", e instanceof Error ? e.message : "Rate unavailable", 422);
  });
  const sourceMajor = fromUsd(toUsd(input.destAmount, input.destCurrency, rates), input.sourceCurrency, rates);
  let sourceMinor = Math.ceil(sourceMajor * 10 ** expOf(input.sourceCurrency));
  for (let i = 0; i < 4; i++) {
    const q = await evaluateQuote(orgId, { ...input, sourceAmount: sourceMinor });
    const short = input.destAmount - q.destAmountMinor;
    if (short <= 0 && short > -Math.max(2, Math.round(input.destAmount * 0.0005))) break;
    // scale the source amount by the observed shortfall (in source currency)
    const shortSource = (short / input.destAmount) * sourceMinor;
    sourceMinor = Math.max(1, Math.ceil(sourceMinor + shortSource + 1));
  }
  return createQuote(orgId, { ...input, sourceAmount: sourceMinor });
}

// ── Public serialisation ─────────────────────────────────────────────────────────

export function serializeTransfer(t: Transfer & { deposits?: Array<{ status: string; txHash: string | null; confirmations: number }> }) {
  const route = t.route as unknown as Route;
  return {
    id: t.id,
    status: t.status,
    status_reason: t.statusReason,
    kind: t.kind,
    sandbox: t.isSandbox,
    source: { currency: t.sourceCurrency, amount: Number(t.sourceAmount), country: t.originCountry },
    destination: { currency: t.destCurrency, amount: Number(t.destAmount), country: t.destCountry },
    funding_method: t.fundingMethod,
    funding_instructions: t.fundingInstructions ?? null,
    route: summariseRoute(route),
    fees: { markup_bps: t.markupBps, vaulte_markup_usd: Number(t.markupUsd) / 100, partner_cost_usd: Number(t.partnerCostUsd) / 100 },
    purpose_code: t.purposeCode,
    invoice_id: t.invoiceId,
    efira_ref: t.efiraRef,
    external_ref: t.externalRef,
    deposit: t.deposits?.[0] ?? null,
    created_at: t.createdAt.toISOString(),
    completed_at: t.completedAt?.toISOString() ?? null,
    note: "Vaulte does not hold funds. The licensed partner receives, converts and pays out.",
  };
}
