import { describe, expect, it } from "vitest";
import { CHART, NORMAL_BALANCE } from "../lib/ledger/chart";
import { journalHash, LedgerError, periodBounds, periodIdFor, validateLines, type GlLine } from "../lib/ledger/gl";
import { feesTakenLines, fundsReceivedLines, payoutLines, revenueLines, type TransferFin } from "../lib/ledger/transfers";
import { GUARD_SQL } from "../lib/ledger/guards";

const L = (account: string, currency: string, amountMinor: bigint, baseUsdCents: bigint): GlLine => ({ account, currency, amountMinor, baseUsdCents });

describe("journal validation", () => {
  it("accepts a balanced single-currency journal", () => {
    expect(() => validateLines([L("1000", "USD", 500n, 500n), L("4900", "USD", -500n, -500n)])).not.toThrow();
  });
  it("rejects unbalanced, one-sided, zero and wrong-sign lines", () => {
    expect(() => validateLines([L("1000", "USD", 500n, 500n), L("4900", "USD", -499n, -499n)])).toThrow(LedgerError);
    expect(() => validateLines([L("1000", "USD", 500n, 500n)])).toThrow(/two lines/);
    expect(() => validateLines([L("1000", "USD", 0n, 0n), L("4900", "USD", 0n, 0n)])).toThrow(/Zero/);
    expect(() => validateLines([L("1000", "EUR", 500n, -460n), L("4900", "EUR", -500n, 460n)])).toThrow(/same sign/);
    expect(() => validateLines([L("1000", "USD", 500n, 400n), L("4900", "USD", -500n, -400n)])).toThrow(/USD lines/);
  });
  it("requires balance in EVERY currency, not just in USD (FX goes through clearing lines)", () => {
    // EUR 100 in, USD 108 out: USD-balanced (base 0) but not per currency
    expect(() => validateLines([L("1000", "EUR", 10000n, 10800n), L("1000", "USD", -10800n, -10800n)])).toThrow(/EUR/);
    // with a clearing account in each currency it is valid
    expect(() => validateLines([
      L("1000", "EUR", 10000n, 10800n), L("5100", "EUR", -10000n, -10800n),
      L("5100", "USD", 10800n, 10800n), L("1000", "USD", -10800n, -10800n),
    ])).not.toThrow();
  });
});

describe("hash chain and periods", () => {
  const j = (seq: number, amount = 100n) => ({ seq, kind: "X", entryDate: new Date("2026-10-05T00:00:00Z"), idempotencyKey: `k${seq}`, lines: [{ account: "1000", currency: "USD", amountMinor: amount, baseUsdCents: amount }, { account: "4900", currency: "USD", amountMinor: -amount, baseUsdCents: -amount }] });
  it("hash depends on the previous hash, the content and line order does not matter", () => {
    const h1 = journalHash("GENESIS", j(1));
    expect(journalHash("GENESIS", j(1))).toBe(h1);
    expect(journalHash("OTHER", j(1))).not.toBe(h1);
    expect(journalHash("GENESIS", j(1, 101n))).not.toBe(h1);
    const rev = j(1); rev.lines.reverse();
    expect(journalHash("GENESIS", rev)).toBe(h1);
    expect(journalHash(h1, j(2))).not.toBe(journalHash("GENESIS", j(2)));
  });
  it("period ids and bounds", () => {
    expect(periodIdFor(new Date("2026-10-31T23:59:59Z"))).toBe("2026-10");
    expect(periodIdFor(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11");
    const b = periodBounds("2026-02");
    expect(b.startsOn.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(b.endsOn.toISOString()).toBe("2026-02-28T23:59:59.999Z");
  });
});

describe("chart of accounts", () => {
  it("codes are unique, normal balances follow the account type, memo accounts are 9xxx", () => {
    const codes = CHART.map(a => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(NORMAL_BALANCE("ASSET")).toBe("DEBIT"); expect(NORMAL_BALANCE("EXPENSE")).toBe("DEBIT");
    expect(NORMAL_BALANCE("LIABILITY")).toBe("CREDIT"); expect(NORMAL_BALANCE("REVENUE")).toBe("CREDIT"); expect(NORMAL_BALANCE("EQUITY")).toBe("CREDIT");
    expect(CHART.filter(a => a.isMemo).every(a => a.code.startsWith("9"))).toBe(true);
    expect(CHART.filter(a => a.code.startsWith("9")).every(a => a.isMemo)).toBe(true);
  });
  it("ships database guards for immutability, balance and closed periods", () => {
    const sql = GUARD_SQL.join("\n");
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON "GlJournal"/);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON "GlEntry"/);
    expect(sql).toMatch(/CREATE TRIGGER gl_entry_balanced AFTER INSERT ON "GlEntry" REFERENCING NEW TABLE/);
    expect(sql).toMatch(/gl_check_period_open/);
  });
});

describe("transfer bookings", () => {
  const usdT: TransferFin = { id: "t1", organizationId: "o1", sourceCurrency: "USD", sourceAmountMinor: 100_000n, sourceUsdCents: 100_000n, partnerCostUsdCents: 350n, markupUsdCents: 300n };
  const eurT: TransferFin = { id: "t2", organizationId: "o1", sourceCurrency: "EUR", sourceAmountMinor: 92_113n, sourceUsdCents: 100_000n, partnerCostUsdCents: 357n, markupUsdCents: 301n };
  const sum = (lines: GlLine[][], code: string, cur?: string) => lines.flat().filter(l => l.account === code && (!cur || l.currency === cur)).reduce((s, l) => s + l.amountMinor, 0n);

  for (const [name, t] of [["USD", usdT], ["EUR", eurT]] as const) {
    it(`every journal balances in all currencies (${name} transfer, NET and GROSS)`, () => {
      for (const basis of ["NET", "GROSS"] as const) {
        const js = [fundsReceivedLines(t), feesTakenLines(t), payoutLines(t), revenueLines(t, basis)];
        js.forEach(validateLines);
      }
    });
    it(`a completed ${name} transfer leaves customer obligations and partner-held funds at zero`, () => {
      const js = [fundsReceivedLines(t), feesTakenLines(t), payoutLines(t)];
      expect(sum(js, "9200", t.sourceCurrency)).toBe(0n);
      expect(sum(js, "9100", t.sourceCurrency)).toBe(0n);
    });
  }
  it("NET basis books only the markup as revenue; GROSS books all fees as revenue and the partner cost as expense", () => {
    expect(sum([revenueLines(usdT, "NET")], "4000")).toBe(-300n);
    expect(sum([revenueLines(usdT, "NET")], "1100")).toBe(300n);
    const g = [revenueLines(usdT, "GROSS")];
    expect(sum(g, "4100")).toBe(-650n); expect(sum(g, "5000")).toBe(350n); expect(sum(g, "2000")).toBe(-350n); expect(sum(g, "1100")).toBe(650n);
  });
  it("fees in a foreign currency use the transfer's own ratio and never lose a cent to rounding", () => {
    const f = feesTakenLines(eurT)[0]; const p = payoutLines(eurT)[0]; const r = fundsReceivedLines(eurT)[0];
    expect(f.amountMinor + p.amountMinor).toBe(r.amountMinor);
    expect(f.baseUsdCents + p.baseUsdCents).toBe(r.baseUsdCents);
    expect(f.baseUsdCents).toBe(658n);
  });
  it("revenue lines carry the customer dimension for per-customer reporting", () => {
    expect(revenueLines(usdT, "NET").find(l => l.account === "4000")!.organizationId).toBe("o1");
    expect(fundsReceivedLines(usdT).find(l => l.account === "9200")!.organizationId).toBe("o1");
  });
});
