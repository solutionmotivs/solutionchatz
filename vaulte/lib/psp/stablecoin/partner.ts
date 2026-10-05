// Contract every licensed partner adapter implements. Partners hold the funds, run KYC/KYB,
// screen wallets, convert and pay out. Vaulte only orchestrates.
import type { Chain, Route, Token } from "@/lib/stablecoin/types";

export interface DepositInstruction {
  partnerRef: string;
  address: string;
  chain: Chain;
  token: Token;
  expiresAt: Date;
  memo?: string;
}

export interface FiatFundingInstruction {
  partnerRef: string;
  reference: string;
  bankDetails: Record<string, string>;
}

/** Where the recipient is paid. Real partners need this; the sandbox mock ignores it. */
export interface BeneficiaryDetails {
  accountName: string;
  entityType: "PERSONAL" | "COMPANY";
  bankCountry: string;
  currency: string;
  iban?: string;
  swiftBic?: string;
  accountNumber?: string;
  routingNumber?: string;
  sortCode?: string;
  bankName?: string;
}

export interface PayoutRequest {
  transferId: string;
  route: Route;
  destCurrency: string;
  destAmountMinor: bigint;
  recipientName: string;
  recipientCountry: string;
  purposeCode?: string | null;
  invoiceNumber?: string | null;
  beneficiary?: BeneficiaryDetails;
}

export interface PayoutResult {
  partnerRef: string;
}

export interface VirtualAccountRequest {
  entityId: string;
  legalName: string;
  country: string;
  currency: string;
}

export interface VirtualAccountResult {
  partnerRef: string;
  details: Record<string, string>;
}

export interface StablecoinPartner {
  readonly id: string;
  createDeposit(opts: { transferId: string; token: Token; chain: Chain; expectedAmountMicro: bigint }): Promise<DepositInstruction>;
  createFiatFunding(opts: { transferId: string; currency: string; amountMinor: bigint }): Promise<FiatFundingInstruction>;
  createPayout(req: PayoutRequest): Promise<PayoutResult>;
  createVirtualAccount(req: VirtualAccountRequest): Promise<VirtualAccountResult>;
  verifyWebhook(rawBody: string, headers: Headers): boolean;
  /** Convert the partner's own webhook payload into Vaulte's event shape ({id, type, data}); null = not relevant. */
  normalizeWebhook?(payload: unknown): { id: string; type: string; data: Record<string, unknown> } | null;
}
