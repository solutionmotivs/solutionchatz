// Sandbox partner: deterministic, no network, no real money. Used for demos, tests and the e2e flow.
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type {
  DepositInstruction, FiatFundingInstruction, PayoutRequest, PayoutResult, StablecoinPartner,
  VirtualAccountRequest, VirtualAccountResult,
} from "./partner";

export function mockWebhookSecret(): string {
  const s = process.env.MOCK_PARTNER_WEBHOOK_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("MOCK_PARTNER_WEBHOOK_SECRET must be set");
  return "dev-mock-partner-secret";
}

export function signMockWebhook(rawBody: string): string {
  return createHmac("sha256", mockWebhookSecret()).update(rawBody).digest("hex");
}

const rid = (n = 8) => randomBytes(n).toString("hex");

export class MockPartner implements StablecoinPartner {
  constructor(readonly id: string) {}

  async createDeposit(opts: { transferId: string; token: DepositInstruction["token"]; chain: DepositInstruction["chain"]; expectedAmountMicro: bigint }): Promise<DepositInstruction> {
    return {
      partnerRef: `mock_dep_${rid(6)}`,
      address: `mock_${opts.chain}_${rid(10)}`,
      chain: opts.chain,
      token: opts.token,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      memo: opts.chain === "tron" ? undefined : undefined,
    };
  }

  async createFiatFunding(opts: { transferId: string; currency: string; amountMinor: bigint }): Promise<FiatFundingInstruction> {
    return {
      partnerRef: `mock_fund_${rid(6)}`,
      reference: opts.transferId,
      bankDetails: { account_name: `Mock Partner ${this.id}`, iban_or_account: `MOCK${rid(8).toUpperCase()}`, currency: opts.currency, reference: opts.transferId },
    };
  }

  async createPayout(req: PayoutRequest): Promise<PayoutResult> {
    return { partnerRef: `mock_pay_${req.transferId.slice(-6)}_${rid(4)}` };
  }

  async createVirtualAccount(req: VirtualAccountRequest): Promise<VirtualAccountResult> {
    const details: Record<string, string> = { account_holder: req.legalName, currency: req.currency, country: req.country };
    if (req.currency === "EUR") details.iban = `MOCKEU${rid(8).toUpperCase()}`;
    else if (req.currency === "GBP") { details.sort_code = "00-00-00"; details.account_number = String(Math.floor(Math.random() * 1e8)).padStart(8, "0"); }
    else if (req.currency === "USD") { details.routing_number = "000000000"; details.account_number = String(Math.floor(Math.random() * 1e10)).padStart(10, "0"); }
    else if (req.currency === "CAD") { details.institution_number = "000"; details.transit_number = "00000"; details.account_number = String(Math.floor(Math.random() * 1e9)).padStart(9, "0"); }
    else if (req.currency === "AUD") { details.bsb = "000-000"; details.account_number = String(Math.floor(Math.random() * 1e9)).padStart(9, "0"); }
    else details.account_number = `MOCK${rid(6).toUpperCase()}`;
    return { partnerRef: `mock_va_${rid(6)}`, details };
  }

  verifyWebhook(rawBody: string, headers: Headers): boolean {
    const given = headers.get("x-partner-signature") ?? "";
    const expected = signMockWebhook(rawBody);
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
