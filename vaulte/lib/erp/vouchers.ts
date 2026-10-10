// Turn a completed transfer into the accounting entry the CUSTOMER books in their own ERP.
// (This is not Vaulte's ledger: see lib/ledger for that.) One balanced voucher per transfer, in one currency.
export type Perspective = "PAYMENT" | "RECEIPT";

export interface VoucherLine { role: "BANK" | "PARTY" | "CHARGES"; side: "DEBIT" | "CREDIT"; amountMinor: bigint }

export interface Voucher {
  /** Stable id, also the idempotency key at the ERP. */
  id: string;
  transferId: string;
  date: Date;
  type: Perspective;
  currency: string;
  reference: string;
  narration: string;
  party: string;
  lines: VoucherLine[];
}

export interface TransferForVoucher {
  id: string;
  completedAt: Date | null;
  createdAt: Date;
  sourceCurrency: string;
  destCurrency: string;
  sourceAmount: bigint;
  destAmount: bigint;
  sourceAmountUsd: bigint;
  partnerCostUsd: bigint;
  markupUsd: bigint;
  externalRef: string | null;
  originCountry: string;
  destCountry: string;
  fundingMethod: string;
  senderName: string;
  recipientName: string;
  invoiceNumber: string | null;
}

/** Which side of the transfer the customer is on. AUTO: money arriving in the customer's own country = receipt. */
export function perspectiveFor(t: Pick<TransferForVoucher, "destCountry" | "originCountry" | "fundingMethod">, orgCountry: string | null, forced?: Perspective | "AUTO"): Perspective {
  if (forced && forced !== "AUTO") return forced;
  if (t.fundingMethod === "VIRTUAL_ACCOUNT") return "RECEIPT";
  if (orgCountry && t.destCountry === orgCountry && t.originCountry !== orgCountry) return "RECEIPT";
  return "PAYMENT";
}

const HOME_CURRENCY: Record<string, string> = { IN: "INR", US: "USD", GB: "GBP", AE: "AED", SG: "SGD", AU: "AUD", CA: "CAD", JP: "JPY", CH: "CHF", DE: "EUR", FR: "EUR", NL: "EUR", IE: "EUR", ES: "EUR", IT: "EUR" };
export const homeCurrency = (country: string | null) => (country && HOME_CURRENCY[country]) || "USD";

export function buildVoucher(t: TransferForVoucher, perspective: Perspective): Voucher {
  const fees = t.partnerCostUsd + t.markupUsd;
  const date = t.completedAt ?? t.createdAt;
  const reference = t.invoiceNumber ?? t.id;
  if (perspective === "PAYMENT") {
    const feesSrc = t.sourceCurrency === "USD" ? fees : t.sourceAmountUsd === 0n ? 0n : (fees * t.sourceAmount * 2n + t.sourceAmountUsd) / (t.sourceAmountUsd * 2n);
    const party = t.sourceAmount - feesSrc;
    return {
      id: `vaulte-${t.id}-pay`, transferId: t.id, date, type: "PAYMENT", currency: t.sourceCurrency, reference, party: t.recipientName,
      narration: `Cross-border payment to ${t.recipientName} (${t.destCountry}) ref ${reference}${t.externalRef ? ` partner ${t.externalRef}` : ""}`,
      lines: [{ role: "PARTY", side: "DEBIT", amountMinor: party }, ...(feesSrc > 0n ? [{ role: "CHARGES" as const, side: "DEBIT" as const, amountMinor: feesSrc }] : []), { role: "BANK", side: "CREDIT", amountMinor: t.sourceAmount }],
    };
  }
  const destUsd = t.sourceAmountUsd - fees;
  const feesDest = destUsd <= 0n ? 0n : (fees * t.destAmount * 2n + destUsd) / (destUsd * 2n);
  return {
    id: `vaulte-${t.id}-rcpt`, transferId: t.id, date, type: "RECEIPT", currency: t.destCurrency, reference, party: t.senderName,
    narration: `Cross-border receipt from ${t.senderName} (${t.originCountry}) ref ${reference}${t.externalRef ? ` partner ${t.externalRef}` : ""}`,
    lines: [{ role: "BANK", side: "DEBIT", amountMinor: t.destAmount }, ...(feesDest > 0n ? [{ role: "CHARGES" as const, side: "DEBIT" as const, amountMinor: feesDest }] : []), { role: "PARTY", side: "CREDIT", amountMinor: t.destAmount + feesDest }],
  };
}

export function voucherBalanced(v: Voucher): boolean {
  return v.lines.reduce((s, l) => s + (l.side === "DEBIT" ? l.amountMinor : -l.amountMinor), 0n) === 0n;
}

export interface ErpMapping {
  /** Account/ledger names or ids at the ERP. */
  bank?: string;
  charges?: string;
  /** Clearing account for the counterparty side (do NOT use a receivable/payable control account unless your ERP allows lines without a contact). */
  party?: string;
  base_currency?: string;
  /** Tally: create missing ledgers (party ledgers under Sundry Debtors/Creditors, charges under Indirect Expenses). */
  create_masters?: boolean;
  company?: string;
}

export const DEFAULT_MAPPING: Required<Pick<ErpMapping, "bank" | "charges" | "party">> = { bank: "Bank Account", charges: "Bank Charges", party: "Cross-border clearing" };

export const money = (minor: bigint, currency = "USD") => { const dec = ["JPY", "KRW"].includes(currency) ? 0 : 2; const neg = minor < 0n; const a = neg ? -minor : minor; if (dec === 0) return `${neg ? "-" : ""}${a}`; return `${neg ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`; };
