// Wise as a payout partner. CUSTODY: funding a transfer "from balance" spends money held at Wise. Use a customer-owned
// profile (WISE_PROFILE_ID) or a segregated partner arrangement; never pool customer money in one Vaulte-owned balance.
import { createHash, createPublicKey, createVerify } from "crypto";
import type { BeneficiaryDetails, DepositInstruction, FiatFundingInstruction, PayoutRequest, PayoutResult, StablecoinPartner, VirtualAccountRequest, VirtualAccountResult } from "@/lib/psp/stablecoin/partner";
import type { WiseClient } from "./client";

/** Wise recipient requirements differ by currency; this covers IBAN, ABA, sort code and SWIFT. Anything else: add a requirements-driven mapper. */
export function wiseRecipient(b: BeneficiaryDetails): { type: string; details: Record<string, unknown> } {
  if (b.iban) return { type: "iban", details: { iban: b.iban } };
  if (b.sortCode && b.accountNumber) return { type: "sort_code", details: { sortCode: b.sortCode.replace(/-/g, ""), accountNumber: b.accountNumber } };
  if (b.routingNumber && b.accountNumber) return { type: "aba", details: { abartn: b.routingNumber, accountNumber: b.accountNumber, accountType: "CHECKING" } };
  if (b.swiftBic && b.accountNumber) return { type: "swift_code", details: { swiftCode: b.swiftBic, accountNumber: b.accountNumber } };
  throw new Error("RECIPIENT_BANK_DETAILS_MISSING: Wise needs an IBAN, sort code, ABA routing or SWIFT with an account number");
}

export class WisePartner implements StablecoinPartner {
  readonly id = "wise";
  constructor(private client: WiseClient, private publicKeyPem = process.env.WISE_WEBHOOK_PUBLIC_KEY?.replace(/\\n/g, "\n")) {}

  async createDeposit(): Promise<DepositInstruction> { throw new Error("Wise does not accept stablecoin deposits"); }
  async createFiatFunding(): Promise<FiatFundingInstruction> { throw new Error("Wise funding is from the partner's own Wise balance; fund that balance directly at Wise"); }
  async createVirtualAccount(_r: VirtualAccountRequest): Promise<VirtualAccountResult> { throw new Error("Wise account details are created in the Wise dashboard/API for the customer's own profile; not provisioned by this adapter"); }

  async createPayout(req: PayoutRequest): Promise<PayoutResult> {
    if (!req.beneficiary) throw new Error("RECIPIENT_BANK_DETAILS_MISSING: add the recipient's bank account before paying out via Wise");
    const leg = req.route.legs[req.route.legs.length - 1];
    const src = leg.srcCurrency ?? req.destCurrency;
    // Fix the target amount so the recipient gets exactly the quoted amount; the rate drift is absorbed by Vaulte's margin.
    const q = await this.client.createQuote({ sourceCurrency: src, targetCurrency: req.destCurrency, targetAmount: Number((Number(req.destAmountMinor) / 100).toFixed(2)) });
    const rec = wiseRecipient(req.beneficiary);
    const acct = await this.client.createRecipient({ currency: req.destCurrency, type: rec.type, accountHolderName: req.beneficiary.accountName, legalType: req.beneficiary.entityType === "COMPANY" ? "BUSINESS" : "PRIVATE", details: rec.details });
    // customerTransactionId must be a UUID; derive deterministically-looking but stable: a retried call with the same id is a no-op at Wise.
    const t = await this.client.createTransfer({ targetAccount: acct.id, quoteUuid: q.id, customerTransactionId: uuidFrom(req.transferId), reference: (req.invoiceNumber ?? req.transferId).slice(0, 35) });
    await this.client.fundTransfer(t.id);
    return { partnerRef: String(t.id) };
  }

  /** Wise signs the raw body: X-Signature-SHA256 = base64 RSA-SHA256. Requires WISE_WEBHOOK_PUBLIC_KEY (PEM from Wise's docs for your environment). */
  verifyWebhook(raw: string, headers: Headers): boolean {
    const sig = headers.get("x-signature-sha256");
    if (!sig || !this.publicKeyPem) return false;
    try { return createVerify("RSA-SHA256").update(raw).verify(createPublicKey(this.publicKeyPem), sig, "base64"); } catch { return false; }
  }

  normalizeWebhook(payload: unknown) {
    const p = payload as { event_type?: string; data?: { resource?: { id?: number | string }; current_state?: string }; subscription_id?: string };
    if (p?.event_type !== "transfers#state-change" || !p.data?.resource?.id) return null;
    const ref = String(p.data.resource.id), state = String(p.data.current_state ?? "");
    const id = `${p.subscription_id ?? "wise"}:${ref}:${state}`;
    if (state === "outgoing_payment_sent") return { id, type: "payout.completed", data: { transfer_ref: ref } };
    if (["funds_refunded", "cancelled", "bounced_back"].includes(state)) return { id, type: "payout.failed", data: { transfer_ref: ref, reason: state } };
    return null;
  }
}

function uuidFrom(s: string): string {
  const h = createHash("sha256").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
