// Memo ledger valued in USD cents. It records obligations and Vaulte's earnings; it is NOT custody:
// the funds themselves sit with licensed partners. Debits are positive, credits negative.
import type { Prisma } from "@prisma/client";

export type Account =
  | "PARTNER_HELD" // funds held by partners on customers' behalf (memo); residual = markup owed to Vaulte
  | "CUSTOMER_LIABILITY" // what is owed to the recipient / customer
  | "PARTNER_COST_PAYABLE" // partner fees and spread to be settled
  | "REV_MARKUP"; // Vaulte markup revenue

export interface JournalLine {
  account: Account;
  amountUsd: bigint;
}

export class LedgerError extends Error {}

export function assertBalanced(lines: JournalLine[]): void {
  if (lines.length < 2) throw new LedgerError("A journal needs at least two entries");
  const sum = lines.reduce((s, l) => s + l.amountUsd, 0n);
  if (sum !== 0n) throw new LedgerError(`Unbalanced journal (sum ${sum})`);
}

const cents = (usd: number) => BigInt(Math.round(usd * 100));

export interface TransferAmounts {
  sourceUsdCents: bigint;
  partnerCostUsdCents: bigint;
  markupUsdCents: bigint;
}

export function amountsFromBreakdown(sourceUsd: number, partnerCostUsd: number, markupUsd: number): TransferAmounts {
  return { sourceUsdCents: cents(sourceUsd), partnerCostUsdCents: cents(partnerCostUsd), markupUsdCents: cents(markupUsd) };
}

/** Funds confirmed received by the partner. */
export function fundsReceivedJournal(a: TransferAmounts): JournalLine[] {
  return [
    { account: "PARTNER_HELD", amountUsd: a.sourceUsdCents },
    { account: "CUSTOMER_LIABILITY", amountUsd: -a.sourceUsdCents },
  ];
}

/** Fees recognised: partner cost payable + Vaulte markup revenue, taken out of the customer's amount. */
export function feesJournal(a: TransferAmounts): JournalLine[] {
  const fees = a.partnerCostUsdCents + a.markupUsdCents;
  return [
    { account: "CUSTOMER_LIABILITY", amountUsd: fees },
    { account: "PARTNER_COST_PAYABLE", amountUsd: -a.partnerCostUsdCents },
    { account: "REV_MARKUP", amountUsd: -a.markupUsdCents },
  ];
}

/** Payout to the recipient completed by the partner; partner cost netted off the partner's balance. */
export function payoutJournals(a: TransferAmounts): JournalLine[][] {
  const payout = a.sourceUsdCents - a.partnerCostUsdCents - a.markupUsdCents;
  return [
    [
      { account: "CUSTOMER_LIABILITY", amountUsd: payout },
      { account: "PARTNER_HELD", amountUsd: -payout },
    ],
    [
      { account: "PARTNER_COST_PAYABLE", amountUsd: a.partnerCostUsdCents },
      { account: "PARTNER_HELD", amountUsd: -a.partnerCostUsdCents },
    ],
  ];
}

export async function postJournal(
  tx: Prisma.TransactionClient,
  opts: { kind: string; transferId?: string; memo?: string; lines: JournalLine[] },
) {
  assertBalanced(opts.lines);
  return tx.ledgerJournal.create({
    data: {
      kind: opts.kind,
      memo: opts.memo ?? null,
      transferId: opts.transferId ?? null,
      entries: { create: opts.lines.map(l => ({ account: l.account, amountUsd: l.amountUsd })) },
    },
  });
}

/** Net balance per account for a transfer (used in tests and reconciliation). */
export async function transferBalances(tx: Prisma.TransactionClient, transferId: string) {
  const entries = await tx.ledgerEntry.findMany({ where: { journal: { transferId } } });
  const out: Record<string, bigint> = {};
  for (const e of entries) out[e.account] = (out[e.account] ?? 0n) + e.amountUsd;
  return out;
}
