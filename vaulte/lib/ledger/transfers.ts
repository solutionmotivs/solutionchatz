// How a transfer is booked. Two layers, both double-entry:
//  * MEMO (9100/9200): customer money held by licensed partners. Tracks obligations; never on Vaulte's balance sheet.
//  * REAL (1100/4000...): Vaulte's own earnings. NET (agent) basis by default: only the markup is revenue and partner
//    costs are a pass-through. Set ACCOUNTING_BASIS=GROSS for principal presentation. Which one applies is an accounting
//    policy for your auditor, not something code can decide.
import type { Prisma } from "@prisma/client";
import { ACCOUNT } from "./chart";
import { postGl, reverseJournal, type GlLine } from "./gl";

export interface TransferFin {
  id: string;
  organizationId: string;
  sourceCurrency: string;
  sourceAmountMinor: bigint;
  sourceUsdCents: bigint;
  partnerCostUsdCents: bigint;
  markupUsdCents: bigint;
}

export const accountingBasis = (): "NET" | "GROSS" => (process.env.ACCOUNTING_BASIS === "GROSS" ? "GROSS" : "NET");

/** Convert USD cents to the transfer's source currency using the transfer's own exchange ratio (integer, half-up). */
function usdToSource(t: TransferFin, usdCents: bigint): bigint {
  if (t.sourceCurrency === "USD") return usdCents;
  if (t.sourceUsdCents === 0n) return 0n;
  return (usdCents * t.sourceAmountMinor * 2n + t.sourceUsdCents) / (t.sourceUsdCents * 2n);
}

const pair = (t: TransferFin, debit: string, credit: string, srcMinor: bigint, usd: bigint, orgOnCredit: boolean, orgOnDebit = false): GlLine[] => [
  { account: debit, currency: t.sourceCurrency, amountMinor: srcMinor, baseUsdCents: usd, organizationId: orgOnDebit ? t.organizationId : null },
  { account: credit, currency: t.sourceCurrency, amountMinor: -srcMinor, baseUsdCents: -usd, organizationId: orgOnCredit ? t.organizationId : null },
];

export const feesUsd = (t: TransferFin) => t.partnerCostUsdCents + t.markupUsdCents;

export function fundsReceivedLines(t: TransferFin): GlLine[] {
  return pair(t, ACCOUNT.MEMO_HELD, ACCOUNT.MEMO_OBLIGATIONS, t.sourceAmountMinor, t.sourceUsdCents, true);
}

export function feesTakenLines(t: TransferFin): GlLine[] {
  const usd = feesUsd(t);
  return pair(t, ACCOUNT.MEMO_OBLIGATIONS, ACCOUNT.MEMO_HELD, usdToSource(t, usd), usd, false, true);
}

export function payoutLines(t: TransferFin): GlLine[] {
  const usd = t.sourceUsdCents - feesUsd(t);
  const src = t.sourceAmountMinor - usdToSource(t, feesUsd(t));
  return pair(t, ACCOUNT.MEMO_OBLIGATIONS, ACCOUNT.MEMO_HELD, src, usd, false, true);
}

/** Vaulte's earnings from the transfer. */
export function revenueLines(t: TransferFin, basis = accountingBasis()): GlLine[] {
  const usd = (account: string, cents: bigint, org = false): GlLine => ({ account, currency: "USD", amountMinor: cents, baseUsdCents: cents, organizationId: org ? t.organizationId : null });
  if (basis === "NET") {
    return [usd(ACCOUNT.DUE_FROM_PARTNERS, t.markupUsdCents), usd(ACCOUNT.REV_MARKUP, -t.markupUsdCents, true)];
  }
  const total = feesUsd(t);
  return [
    usd(ACCOUNT.DUE_FROM_PARTNERS, total), usd(ACCOUNT.REV_GROSS, -total, true),
    ...(t.partnerCostUsdCents > 0n ? [usd(ACCOUNT.PARTNER_COSTS, t.partnerCostUsdCents), usd(ACCOUNT.PARTNER_PAYABLE, -t.partnerCostUsdCents)] : []),
  ];
}

const ctx = (t: TransferFin) => ({ source: "TRANSFER" as const, transferId: t.id, organizationId: t.organizationId });
const nonZero = (lines: GlLine[]) => lines.filter(l => l.amountMinor !== 0n || l.baseUsdCents !== 0n);

export async function bookFundsReceived(tx: Prisma.TransactionClient, t: TransferFin) {
  await postGl(tx, { ...ctx(t), kind: "MEMO_FUNDS_RECEIVED", idempotencyKey: `t:${t.id}:funds`, memo: "Partner confirmed receipt of the sender's funds", lines: fundsReceivedLines(t) });
  await postGl(tx, { ...ctx(t), kind: "MEMO_FEES_TAKEN", idempotencyKey: `t:${t.id}:fees_memo`, memo: "Fees deducted from the customer's funds", lines: feesTakenLines(t) });
  const rev = nonZero(revenueLines(t));
  if (rev.length >= 2) await postGl(tx, { ...ctx(t), kind: "REV_FEES", idempotencyKey: `t:${t.id}:rev:1`, memo: "Markup earned", lines: rev });
}

export async function bookPayout(tx: Prisma.TransactionClient, t: TransferFin) {
  await postGl(tx, { ...ctx(t), kind: "MEMO_PAYOUT", idempotencyKey: `t:${t.id}:payout`, memo: "Partner paid the recipient", lines: payoutLines(t) });
}

/** Failover to a partner with a different cost: the customer's total fees stay fixed, only the markup/cost split changes. */
export async function rebookRevenue(tx: Prisma.TransactionClient, t: TransferFin) {
  const all = await tx.glJournal.findMany({ where: { transferId: t.id, kind: "REV_FEES" }, orderBy: { seq: "asc" } });
  const reversed = new Set((await tx.glJournal.findMany({ where: { transferId: t.id, reversalOfId: { not: null } }, select: { reversalOfId: true } })).map(r => r.reversalOfId));
  const open = all.filter(j => !reversed.has(j.id));
  if (!open.length) return; // fees were never booked (failure before funds were confirmed)
  for (const j of open) await reverseJournal(tx, j.id, { memo: "Fee split re-booked after partner failover" });
  const rev = nonZero(revenueLines(t));
  if (rev.length >= 2) await postGl(tx, { ...ctx(t), kind: "REV_FEES", idempotencyKey: `t:${t.id}:rev:${all.length + 1}`, memo: "Markup earned (after failover)", lines: rev });
}

/** Reverse everything booked for a transfer in one journal (failed transfer: the partner refunds the sender). */
export async function bookFailureReversal(tx: Prisma.TransactionClient, t: { id: string; organizationId: string }) {
  const rows = await tx.$queryRaw<{ account: string; currency: string; org: string | null; minor: bigint; base: bigint }[]>`
    SELECT a."code" AS account, e."currency" AS currency, e."organizationId" AS org, SUM(e."amountMinor")::bigint AS minor, SUM(e."baseUsdCents")::bigint AS base
    FROM "GlEntry" e JOIN "GlJournal" j ON j."id" = e."journalId" JOIN "GlAccount" a ON a."id" = e."accountId"
    WHERE j."transferId" = ${t.id}
    GROUP BY a."code", e."currency", e."organizationId"`;
  const lines: GlLine[] = rows.filter(r => r.minor !== 0n || r.base !== 0n).map(r => ({ account: r.account, currency: r.currency, amountMinor: -r.minor, baseUsdCents: -r.base, organizationId: r.org }));
  if (lines.length >= 2) await postGl(tx, { source: "TRANSFER", transferId: t.id, organizationId: t.organizationId, kind: "FAILURE_REVERSAL", idempotencyKey: `t:${t.id}:failure`, memo: "Transfer failed: booked amounts reversed", lines });
}

export function finFromTransfer(t: { id: string; organizationId: string; sourceCurrency: string; sourceAmount: bigint; sourceAmountUsd: bigint; partnerCostUsd: bigint; markupUsd: bigint }): TransferFin {
  return { id: t.id, organizationId: t.organizationId, sourceCurrency: t.sourceCurrency, sourceAmountMinor: t.sourceAmount, sourceUsdCents: t.sourceAmountUsd, partnerCostUsdCents: t.partnerCostUsd, markupUsdCents: t.markupUsd };
}

/** Net balances of a transfer per account code and currency (tests and reconciliation). */
export async function transferNet(tx: Prisma.TransactionClient, transferId: string): Promise<Record<string, bigint>> {
  const rows = await tx.$queryRaw<{ account: string; currency: string; minor: bigint }[]>`
    SELECT a."code" AS account, e."currency" AS currency, SUM(e."amountMinor")::bigint AS minor
    FROM "GlEntry" e JOIN "GlJournal" j ON j."id" = e."journalId" JOIN "GlAccount" a ON a."id" = e."accountId"
    WHERE j."transferId" = ${transferId} GROUP BY a."code", e."currency"`;
  const out: Record<string, bigint> = {};
  for (const r of rows) out[`${r.account}:${r.currency}`] = r.minor;
  return out;
}
