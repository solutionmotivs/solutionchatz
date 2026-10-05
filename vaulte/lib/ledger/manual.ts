// Staff-posted journals (bank receipts, partner remittances, accruals, corrections). Always carry a reason and the staff id.
import { db } from "@/lib/db";
import { getRateTable } from "@/lib/stablecoin/rates";
import { LedgerError, postGl, type GlLine } from "./gl";

export interface ManualLineInput {
  account: string;
  currency: string;
  side: "DEBIT" | "CREDIT";
  /** Decimal string in major units, e.g. "1250.50". */
  amount: string;
  organizationId?: string;
}

const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP"]);

export function toMinor(amount: string, currency: string): bigint {
  const dec = ZERO_DECIMAL.has(currency) ? 0 : 2;
  const re = dec === 0 ? /^\d{1,15}$/ : /^\d{1,13}(\.\d{1,2})?$/;
  if (!re.test(amount)) throw new LedgerError(`Invalid amount "${amount}" for ${currency}`);
  const [w, f = ""] = amount.split(".");
  return BigInt(w + f.padEnd(dec, "0"));
}

/** USD value of each line using the current rate table; rounding differences are absorbed in the last line of each currency. */
export async function toGlLines(inputs: ManualLineInput[]): Promise<GlLine[]> {
  const currencies = Array.from(new Set(inputs.map(i => i.currency)));
  const rates = await getRateTable(currencies);
  const lines: GlLine[] = inputs.map(i => {
    const minor = toMinor(i.amount, i.currency);
    const signed = i.side === "DEBIT" ? minor : -minor;
    const rate = rates[i.currency];
    const base = i.currency === "USD" ? signed : BigInt(Math.round((Number(signed) / 100 / rate) * 100));
    return { account: i.account, currency: i.currency, amountMinor: signed, baseUsdCents: base, organizationId: i.organizationId ?? null };
  });
  // Non-USD currencies net to zero in amount, so their USD values must net to zero too: plug rounding into the last line.
  for (const c of currencies.filter(c => c !== "USD")) {
    const idx = lines.map((l, i) => (l.currency === c ? i : -1)).filter(i => i >= 0);
    const drift = idx.reduce((s, i) => s + lines[i].baseUsdCents, 0n);
    if (drift !== 0n && idx.length) lines[idx[idx.length - 1]].baseUsdCents -= drift;
  }
  return lines;
}

export async function postManualJournal(opts: { staffId: string; memo: string; date?: Date; lines: ManualLineInput[]; idempotencyKey?: string }) {
  if (opts.memo.trim().length < 10) throw new LedgerError("Describe why this entry is needed (at least 10 characters)");
  const accounts = await db.glAccount.findMany({ where: { code: { in: opts.lines.map(l => l.account) } } });
  for (const l of opts.lines) {
    const a = accounts.find(x => x.code === l.account);
    if (!a) throw new LedgerError(`Unknown account ${l.account}`);
    if (a.isMemo) throw new LedgerError(`Account ${l.account} is a memorandum account driven by transfers; it cannot be posted manually`);
  }
  const lines = await toGlLines(opts.lines);
  return db.$transaction(tx => postGl(tx, { kind: "MANUAL", source: "MANUAL", memo: opts.memo.trim(), lines, entryDate: opts.date, createdById: opts.staffId, idempotencyKey: opts.idempotencyKey }));
}
