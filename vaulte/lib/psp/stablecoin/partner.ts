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
  ifsc?: string;
  /** India: UPI ID (VPA); the partner verifies it before paying. */
  upiId?: string;
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
  /** India: the rail chosen for this payout (UPI, IMPS, RTGS or NEFT). */
  rail?: string;
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

/** A certificate or confirmation a partner makes available for a transfer it executed. */
export interface PartnerDocument { type: "EFIRA" | "FIRC" | "EBRC" | "BRC" | "BANK_CERT" | "IRM"; number: string; issuedOn?: string; refs?: Record<string, string>; file?: { data: Buffer; name: string } }

/** What Vaulte sends a partner about a customer it has already verified. The partner stays the decision-maker on whether to accept the customer. */
export interface CustomerPackage {
  organizationId: string;
  legalName: string;
  country: string;
  registrationNumber: string | null;
  taxId: string | null;
  businessType: string | null;
  riskTier: string;
  kybApprovedAt: string | null;
}
export type PartnerCustomerState = "SUBMITTED" | "NEEDS_INFO" | "APPROVED" | "REJECTED";
export interface PartnerCustomerResult { partnerRef: string; status: PartnerCustomerState; note?: string }

export interface StablecoinPartner {
  readonly id: string;
  /** Optional: onboard the customer at the partner (Vaulte's KYB package in, partner's decision out). Partners without an API are handled by staff after the partner confirms. */
  submitCustomer?(pkg: CustomerPackage): Promise<PartnerCustomerResult>;
  /** Optional: poll the partner's decision for a previously submitted customer. */
  getCustomerStatus?(partnerRef: string): Promise<PartnerCustomerResult>;
  createDeposit(opts: { transferId: string; token: Token; chain: Chain; expectedAmountMicro: bigint }): Promise<DepositInstruction>;
  createFiatFunding(opts: { transferId: string; currency: string; amountMinor: bigint }): Promise<FiatFundingInstruction>;
  createPayout(req: PayoutRequest): Promise<PayoutResult>;
  createVirtualAccount(req: VirtualAccountRequest): Promise<VirtualAccountResult>;
  /** Optional: certificates/confirmations the partner holds for a payout it made. Polled by the certificate job; nothing is trusted as verified unless the partner is. */
  listDocuments?(q: { partnerRef: string | null; transferId: string; destCountry: string; purposeCode: string | null; completedAt: Date | null }): Promise<PartnerDocument[]>;
  verifyWebhook(rawBody: string, headers: Headers, url?: URL): boolean;
  /** Convert the partner's own webhook payload into Vaulte's event shape ({id, type, data}); null = not relevant. */
  normalizeWebhook?(payload: unknown): { id: string; type: string; data: Record<string, unknown> } | null;
}
