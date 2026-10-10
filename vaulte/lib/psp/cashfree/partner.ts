// Cashfree Payouts as the India payout leg: INR to a bank account (IMPS / NEFT / RTGS) or a UPI ID, paid from the Cashfree account's payout balance.
// PAYOUT ONLY. Cashfree does not issue per-customer accounts, take foreign-currency funding or onboard Vaulte's customers, so this adapter has no
// collection, wallet or customer-onboarding side. WHO FUNDS THE PAYOUT BALANCE is a business and licensing question, not a code one: a balance
// topped up by Vaulte would make Vaulte advance money (a pre-fund), which the no-custody model does not allow. Until Cashfree confirms in writing
// how a licensed funding party tops the balance up per transfer, this adapter is not wired as a live routing leg (see docs/PARTNER_SETUP.md).
import type { DepositInstruction, FiatFundingInstruction, PartnerPayoutStatus, PayoutRequest, PayoutResult, StablecoinPartner, VirtualAccountRequest, VirtualAccountResult } from "@/lib/psp/stablecoin/partner";
import { majorString } from "@/lib/currency";
import { CashfreeClient, type CashfreeTransfer } from "./client";

const MODES: Record<string, string> = { UPI: "upi", IMPS: "imps", NEFT: "neft", RTGS: "rtgs" };

/** Cashfree transfer statuses: RECEIVED / APPROVAL_PENDING / PENDING are in flight; SUCCESS is paid; the rest did not (or no longer) pay. */
export function mapCashfreePayoutStatus(status: string, detail = ""): PartnerPayoutStatus {
  const s = status.toUpperCase();
  if (s === "SUCCESS") return { state: "PAID" };
  if (["FAILED", "REJECTED", "REVERSED", "ERROR", "CANCELLED"].includes(s)) return { state: "FAILED", reason: `${s.toLowerCase()}${detail ? `: ${detail}` : ""}` };
  return { state: "PENDING" };
}

const alpha = (v: string, max: number) => v.normalize("NFKD").replace(/[^A-Za-z .'-]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const text = (v: string, max: number) => v.replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Cashfree transfer request for one Vaulte payout; throws a RECIPIENT_BANK_DETAILS_MISSING-style error when the recipient cannot be paid by it. */
export function cashfreeTransfer(req: PayoutRequest) {
  const b = req.beneficiary;
  if (!b) throw new Error("RECIPIENT_BANK_DETAILS_MISSING: add the recipient's bank account or UPI ID before paying out via Cashfree");
  if (req.destCurrency !== "INR") throw new Error(`Cashfree pays INR only (asked for ${req.destCurrency})`);
  const wantsUpi = (req.rail ?? "").toUpperCase() === "UPI";
  const account = b.accountNumber?.replace(/\s/g, ""), ifsc = b.ifsc?.toUpperCase();
  if (wantsUpi && !b.upiId && !(account && ifsc)) throw new Error("RECIPIENT_BANK_DETAILS_MISSING: UPI payout needs the recipient's UPI ID");
  if (!wantsUpi && !(account && ifsc)) throw new Error("RECIPIENT_BANK_DETAILS_MISSING: Cashfree needs the recipient's account number and IFSC");
  const useUpi = wantsUpi && !!b.upiId;
  const mode = useUpi ? "upi" : MODES[(req.rail ?? "").toUpperCase()] && (req.rail ?? "").toUpperCase() !== "UPI" ? MODES[(req.rail ?? "").toUpperCase()] : "banktransfer";
  const name = alpha(b.accountName || req.recipientName, 100);
  if (!name) throw new Error("RECIPIENT_BANK_DETAILS_MISSING: recipient name has no usable letters for the Indian banking system");
  return {
    transfer_id: req.transferId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40),
    transfer_amount: Number(majorString(req.destAmountMinor, "INR")),
    transfer_currency: "INR" as const,
    transfer_mode: mode,
    transfer_remarks: text(req.invoiceNumber ? `Vaulte ${req.invoiceNumber}` : "Vaulte payout", 70),
    beneficiary_details: {
      beneficiary_name: name,
      beneficiary_instrument_details: useUpi ? { vpa: b.upiId!.trim() } : { bank_account_number: account!, bank_ifsc: ifsc! },
    },
  };
}

export class CashfreePartner implements StablecoinPartner {
  readonly id = "cashfree";
  constructor(private client: CashfreeClient) {}

  async createDeposit(): Promise<DepositInstruction> { throw new Error("Cashfree does not accept stablecoin deposits"); }
  async createFiatFunding(): Promise<FiatFundingInstruction> { throw new Error("Cashfree Payouts is funded from the payout balance of the Cashfree account; it does not issue per-transfer funding details"); }
  async createVirtualAccount(_r: VirtualAccountRequest): Promise<VirtualAccountResult> { throw new Error("Cashfree Payouts does not issue virtual accounts for Vaulte's customers"); }

  async createPayout(req: PayoutRequest): Promise<PayoutResult> {
    const body = cashfreeTransfer(req);
    const r = await this.client.createTransfer(body);
    // transfer_id is our own id: asking again for the same transfer is safe (Cashfree refuses a duplicate), and it is what status and webhooks key on.
    return { partnerRef: r.transfer_id ?? body.transfer_id };
  }

  async getPayoutStatus(partnerRef: string): Promise<PartnerPayoutStatus> {
    const t = await this.client.getTransfer(partnerRef);
    return mapCashfreePayoutStatus(t.status, t.status_description ?? "");
  }

  /** V2 webhooks are signed with the client secret: HMAC-SHA256 over timestamp + raw body, base64, in x-webhook-signature. Stale timestamps are refused. */
  verifyWebhook(raw: string, headers: Headers): boolean {
    const ts = headers.get("x-webhook-timestamp") ?? "", sig = headers.get("x-webhook-signature") ?? "";
    const n = Number(ts);
    if (Number.isFinite(n) && n > 0) { const ms = n < 1e12 ? n * 1000 : n; if (Math.abs(Date.now() - ms) > 60 * 60_000) return false; }
    return this.client.verifyWebhookSignature(raw, sig, ts);
  }

  normalizeWebhook(payload: unknown) {
    const p = payload as { type?: string; data?: Partial<CashfreeTransfer> & { transfer?: Partial<CashfreeTransfer> } };
    const d = p?.data?.transfer ?? p?.data;
    const id = d?.transfer_id;
    if (!p?.type?.startsWith("TRANSFER_") || !id) return null;
    const m = mapCashfreePayoutStatus(String(d?.status ?? p.type.replace(/^TRANSFER_/, "")), d?.status_description ?? "");
    if (m.state === "PAID") return { id: `payout:${id}:paid`, type: "payout.completed", data: { transfer_ref: id, ...(d?.transfer_utr ? { utr: d.transfer_utr } : {}) } };
    if (m.state === "FAILED") return { id: `payout:${id}:failed`, type: "payout.failed", data: { transfer_ref: id, reason: m.reason ?? "cashfree payout failed" } };
    return null; // acknowledged / pending: progress only
  }
}
