// Double-entry general ledger: validation, hash chain, posting, reversal.
import { createHash } from "crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { CHART, NORMAL_BALANCE } from "./chart";
import { ensureLedgerGuards } from "./guards";

export class LedgerError extends Error {}

export interface GlLine {
  /** Account code from the chart. */
  account: string;
  currency: string;
  /** Signed minor units in `currency`: debit positive, credit negative. */
  amountMinor: bigint;
  /** Signed USD cents equivalent (the base currency). */
  baseUsdCents: bigint;
  organizationId?: string | null;
}

/** Pure validation, also used by tests. Throws LedgerError. */
export function validateLines(lines: GlLine[]): void {
  if (lines.length < 2) throw new LedgerError("A journal needs at least two lines");
  for (const l of lines) {
    if (!/^[A-Z]{3}$/.test(l.currency)) throw new LedgerError(`Invalid currency "${l.currency}"`);
    if (l.amountMinor === 0n && l.baseUsdCents === 0n) throw new LedgerError("Zero-value lines are not allowed");
    if ((l.amountMinor > 0n) !== (l.baseUsdCents > 0n) && l.baseUsdCents !== 0n && l.amountMinor !== 0n) throw new LedgerError("A line's amount and its USD value must have the same sign");
    if (l.currency === "USD" && l.amountMinor !== l.baseUsdCents) throw new LedgerError("USD lines must equal their base value");
  }
  const base = lines.reduce((s, l) => s + l.baseUsdCents, 0n);
  if (base !== 0n) throw new LedgerError(`Journal does not balance in USD (off by ${base} cents)`);
  const perCcy = new Map<string, bigint>();
  for (const l of lines) perCcy.set(l.currency, (perCcy.get(l.currency) ?? 0n) + l.amountMinor);
  for (const [c, v] of Array.from(perCcy)) if (v !== 0n) throw new LedgerError(`Journal does not balance in ${c} (off by ${v})`);
}

export function periodIdFor(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function periodBounds(id: string): { startsOn: Date; endsOn: Date } {
  const [y, m] = id.split("-").map(Number);
  return { startsOn: new Date(Date.UTC(y, m - 1, 1)), endsOn: new Date(Date.UTC(y, m, 1) - 1) };
}

/** Canonical content hash for one journal (links to the previous journal's hash). */
export function journalHash(prevHash: string, j: { seq: number; kind: string; entryDate: Date; idempotencyKey?: string | null; lines: { account: string; currency: string; amountMinor: bigint; baseUsdCents: bigint; organizationId?: string | null }[] }): string {
  const lines = j.lines.map(l => [l.account, l.currency, l.amountMinor.toString(), l.baseUsdCents.toString(), l.organizationId ?? ""]).sort((a, b) => a.join("|").localeCompare(b.join("|")));
  return createHash("sha256").update(JSON.stringify({ prev: prevHash, seq: j.seq, kind: j.kind, date: j.entryDate.toISOString(), key: j.idempotencyKey ?? null, lines })).digest("hex");
}

let ready = false;
async function ensureReady() {
  if (ready) return;
  await ensureLedgerGuards();
  await ensureChart();
  ready = true;
}

/** Seed the chart (idempotent). Existing accounts are never changed. */
export async function ensureChart(): Promise<void> {
  for (const a of CHART) {
    await db.glAccount.upsert({
      where: { code: a.code }, update: {},
      create: { code: a.code, name: a.name, type: a.type, normalBalance: NORMAL_BALANCE(a.type), class: a.class, isMemo: !!a.isMemo, description: a.description ?? null },
    });
  }
}

export interface PostInput {
  kind: string;
  source: "TRANSFER" | "MANUAL" | "RECON" | "SYSTEM";
  lines: GlLine[];
  memo?: string;
  transferId?: string;
  organizationId?: string;
  entryDate?: Date;
  idempotencyKey?: string;
  createdById?: string;
  reversalOfId?: string;
}

/**
 * Post one journal inside the caller's transaction. Idempotent on idempotencyKey (returns the existing journal).
 * Journals are serialised through the chain row so seq and hash links are gap-free.
 */
export async function postGl(tx: Prisma.TransactionClient, input: PostInput) {
  await ensureReady();
  validateLines(input.lines);
  if (input.idempotencyKey) {
    const existing = await tx.glJournal.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;
  }
  const codes = Array.from(new Set(input.lines.map(l => l.account)));
  const accounts = await tx.glAccount.findMany({ where: { code: { in: codes } } });
  for (const c of codes) {
    const a = accounts.find(x => x.code === c);
    if (!a) throw new LedgerError(`Unknown account ${c}`);
    if (!a.active) throw new LedgerError(`Account ${c} is inactive`);
  }
  const byCode = new Map(accounts.map(a => [a.code, a.id]));
  const entryDate = input.entryDate ?? new Date();
  const periodId = periodIdFor(entryDate);
  const { startsOn, endsOn } = periodBounds(periodId);
  await tx.glPeriod.upsert({ where: { id: periodId }, update: {}, create: { id: periodId, startsOn, endsOn } });
  const period = await tx.glPeriod.findUniqueOrThrow({ where: { id: periodId } });
  if (period.status === "CLOSED") throw new LedgerError(`Accounting period ${periodId} is closed; post the correction in the current period`);

  // Lock the chain head so concurrent postings queue up and seq/hash stay contiguous.
  await tx.$executeRaw`INSERT INTO "GlChain" ("id","lastSeq","lastHash") VALUES (1, 0, 'GENESIS') ON CONFLICT ("id") DO NOTHING`;
  const [head] = await tx.$queryRaw<{ lastSeq: number; lastHash: string }[]>`SELECT "lastSeq","lastHash" FROM "GlChain" WHERE "id" = 1 FOR UPDATE`;
  const seq = head.lastSeq + 1;
  const hash = journalHash(head.lastHash, { seq, kind: input.kind, entryDate, idempotencyKey: input.idempotencyKey, lines: input.lines });
  const journal = await tx.glJournal.create({
    data: {
      seq, entryDate, periodId, kind: input.kind, source: input.source, memo: input.memo ?? null, transferId: input.transferId ?? null,
      organizationId: input.organizationId ?? null, reversalOfId: input.reversalOfId ?? null, idempotencyKey: input.idempotencyKey ?? null,
      createdById: input.createdById ?? null, prevHash: head.lastHash, hash,
    },
  });
  // One INSERT for all lines: the database checks the whole journal balances in that statement.
  await tx.glEntry.createMany({ data: input.lines.map(l => ({ journalId: journal.id, accountId: byCode.get(l.account)!, currency: l.currency, amountMinor: l.amountMinor, baseUsdCents: l.baseUsdCents, organizationId: l.organizationId ?? null })) });
  await tx.$executeRaw`UPDATE "GlChain" SET "lastSeq" = ${seq}, "lastHash" = ${hash} WHERE "id" = 1`;
  return journal;
}

/** Reverse a posted journal (a new journal with every line negated). Never edits the original. */
export async function reverseJournal(tx: Prisma.TransactionClient, journalId: string, opts: { memo: string; createdById?: string; entryDate?: Date }) {
  const j = await tx.glJournal.findUniqueOrThrow({ where: { id: journalId }, include: { entries: { include: { account: true } } } });
  const already = await tx.glJournal.findUnique({ where: { reversalOfId: journalId } });
  if (already) throw new LedgerError("This journal has already been reversed");
  return postGl(tx, {
    kind: `REVERSAL:${j.kind}`, source: j.source as PostInput["source"], memo: opts.memo, transferId: j.transferId ?? undefined, organizationId: j.organizationId ?? undefined,
    reversalOfId: j.id, createdById: opts.createdById, entryDate: opts.entryDate,
    lines: j.entries.map(e => ({ account: e.account.code, currency: e.currency, amountMinor: -e.amountMinor, baseUsdCents: -e.baseUsdCents, organizationId: e.organizationId })),
  });
}

/** Recompute every hash from the first journal. Returns the first inconsistency, if any. */
export async function verifyChain(): Promise<{ ok: boolean; journals: number; brokenAtSeq?: number; reason?: string }> {
  let prev = "GENESIS"; let n = 0; let cursor = 0;
  for (;;) {
    const batch = await db.glJournal.findMany({ where: { seq: { gt: cursor } }, orderBy: { seq: "asc" }, take: 500, include: { entries: { include: { account: true } } } });
    if (!batch.length) break;
    for (const j of batch) {
      if (j.seq !== cursor + 1 && cursor !== 0) return { ok: false, journals: n, brokenAtSeq: j.seq, reason: `missing journal(s) before seq ${j.seq}` };
      if (j.prevHash !== prev) return { ok: false, journals: n, brokenAtSeq: j.seq, reason: "previous-hash link broken" };
      const expect = journalHash(prev, { seq: j.seq, kind: j.kind, entryDate: j.entryDate, idempotencyKey: j.idempotencyKey, lines: j.entries.map(e => ({ account: e.account.code, currency: e.currency, amountMinor: e.amountMinor, baseUsdCents: e.baseUsdCents, organizationId: e.organizationId })) });
      if (expect !== j.hash) return { ok: false, journals: n, brokenAtSeq: j.seq, reason: "content does not match its hash" };
      prev = j.hash; cursor = j.seq; n++;
    }
  }
  const head = await db.glChain.findUnique({ where: { id: 1 } });
  if (head && head.lastHash !== prev) return { ok: false, journals: n, reason: "chain head does not match the last journal" };
  return { ok: true, journals: n };
}
