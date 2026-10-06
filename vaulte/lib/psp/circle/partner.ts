// Circle Mint as a licensed stablecoin on/off-ramp partner (USDC and EURC; SEPA/SEPA Instant/wire redemption).
//
// READ BEFORE USING LIVE (legal/structural, not technical):
//  1. Circle Mint payouts go only to bank accounts registered on the Mint account (first-party). A Mint account that Vaulte
//     owns and that pools customers' money would make Vaulte the holder of that money. Use it only in a structure counsel has
//     cleared: e.g. each customer's own Mint account, or Circle Payments Network (third-party payouts, Circle as the licensed party).
//  2. Deposits and payouts are confirmed by Circle's SNS notifications (signature = AWS SNS certificate). That verification is not
//     implemented here, so verifyWebhook() refuses everything and a status poller (getPayout/getTransfer) must be added with the contract.
//  3. Test mode never uses this adapter: live legs only, and the route engine blocks any live partner in test mode.
import { createHash } from "crypto";
import { majorString } from "@/lib/currency";
import type { Chain, Token } from "@/lib/stablecoin/types";
import type { DepositInstruction, FiatFundingInstruction, PayoutRequest, PayoutResult, StablecoinPartner, VirtualAccountRequest, VirtualAccountResult } from "@/lib/psp/stablecoin/partner";
import { CIRCLE_CHAINS, CIRCLE_CURRENCY_FOR_TOKEN, type CircleClient } from "./client";

/** CIRCLE_PAYOUT_DESTINATIONS_JSON: {"EUR":{"type":"sepa_instant","id":"<uuid of a registered bank account>"},"USD":{"type":"wire","id":"..."}} */
export type Destinations = Record<string, { type: "wire" | "sepa" | "sepa_instant"; id: string }>;

export class CirclePartner implements StablecoinPartner {
  readonly id = "circle";
  constructor(
    private client: CircleClient,
    private opts: { wireAccountId?: string; destinations?: Destinations; notifyEmail?: string } = {
      wireAccountId: process.env.CIRCLE_WIRE_ACCOUNT_ID, destinations: parseDestinations(process.env.CIRCLE_PAYOUT_DESTINATIONS_JSON), notifyEmail: process.env.CIRCLE_NOTIFY_EMAIL,
    },
  ) {}

  async createDeposit(o: { transferId: string; token: Token; chain: Chain; expectedAmountMicro: bigint }): Promise<DepositInstruction> {
    const currency = CIRCLE_CURRENCY_FOR_TOKEN[o.token];
    if (!currency) throw new Error(`Circle Mint does not handle ${o.token}`);
    const chain = CIRCLE_CHAINS[o.chain];
    if (!chain) throw new Error(`Circle Mint deposits are not offered on ${o.chain}`);
    const r = await this.client.createDepositAddress({ idempotencyKey: uuidFrom(`dep:${o.transferId}`), currency, chain });
    return { partnerRef: r.data.id, address: r.data.address, chain: o.chain, token: o.token, expiresAt: new Date(Date.now() + 24 * 3600_000), memo: r.data.addressTag ?? undefined };
  }

  async createFiatFunding(o: { transferId: string; currency: string; amountMinor: bigint }): Promise<FiatFundingInstruction> {
    if (!this.opts.wireAccountId) throw new Error("CIRCLE_WIRE_ACCOUNT_ID is not set: register a bank account at Circle first");
    const r = (await this.client.wireInstructions(this.opts.wireAccountId)).data;
    const b = r.beneficiaryBank ?? {};
    return {
      partnerRef: r.trackingRef, reference: r.trackingRef,
      bankDetails: Object.fromEntries(Object.entries({ beneficiary: r.beneficiary?.name, bank_name: b.name, swift: b.swiftCode, routing_number: b.routingNumber, account_number: b.accountNumber, currency: b.currency, country: b.country, tracking_reference: r.trackingRef, note: "Put the tracking reference in the wire memo; Circle matches the deposit by it." }).filter(([, v]) => typeof v === "string" && v) as [string, string][]),
    };
  }

  async createVirtualAccount(_r: VirtualAccountRequest): Promise<VirtualAccountResult> { throw new Error("Circle Mint virtual accounts are provisioned in the Circle console; not created by this adapter"); }

  async createPayout(req: PayoutRequest): Promise<PayoutResult> {
    const ccy = req.destCurrency;
    if (ccy !== "USD" && ccy !== "EUR") throw new Error(`Circle Mint redeems only USD and EUR here, not ${ccy}`);
    const dest = this.opts.destinations?.[ccy];
    if (!dest) throw new Error(`No registered Circle payout destination for ${ccy} (CIRCLE_PAYOUT_DESTINATIONS_JSON). Circle Mint pays only bank accounts registered on the account.`);
    if (!this.opts.notifyEmail) throw new Error("CIRCLE_NOTIFY_EMAIL is not set (Circle requires a beneficiary email on payouts)");
    const r = await this.client.createPayout({
      idempotencyKey: uuidFrom(`pay:${req.transferId}`), destination: dest, amount: { amount: majorString(req.destAmountMinor, ccy), currency: ccy },
      beneficiaryEmail: this.opts.notifyEmail, customerExternalRef: req.transferId.replace(/[^A-Za-z0-9-]/g, "").slice(0, 21),
    });
    return { partnerRef: r.data.id };
  }

  /** Circle notifications are SNS messages; their certificate-based signature is not verified here, so nothing is accepted. */
  verifyWebhook(): boolean { return false; }

  /** For a status poller: map a Mint payout/transfer status to Vaulte's event shape. */
  static eventForPayout(id: string, status: string, errorCode?: string | null): { id: string; type: string; data: Record<string, unknown> } | null {
    if (status === "complete") return { id: `circle:${id}:complete`, type: "payout.completed", data: { transfer_ref: id } };
    if (status === "failed") return { id: `circle:${id}:failed`, type: "payout.failed", data: { transfer_ref: id, reason: errorCode ?? "failed" } };
    return null;
  }
}

export function parseDestinations(json?: string): Destinations { try { const j = JSON.parse(json ?? "{}"); return j && typeof j === "object" ? j : {}; } catch { return {}; } }

function uuidFrom(s: string): string {
  const h = createHash("sha256").update(s).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
