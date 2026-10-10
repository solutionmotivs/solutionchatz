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
  /** The sender's own account at this partner (PartnerCustomer.partnerRef): money moves from the customer's sub-account, never a pooled Vaulte one. */
  customerRef?: string;
}

export interface PayoutResult {
  partnerRef: string;
}

export interface VirtualAccountRequest {
  entityId: string;
  legalName: string;
  country: string;
  currency: string;
  /** The customer's own account at this partner (PartnerCustomer.partnerRef), when the partner issues accounts per customer. */
  customerRef?: string;
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
  /** Taken from the approved KYB profile when present; partners that onboard by API need them. */
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  incorporationDate?: string | null;
  industry?: string | null;
  website?: string | null;
  expectedMonthlyUsd?: number | null;
  /** The account owner: the person the partner's contact record is created for. */
  contact?: { firstName: string; lastName: string; email: string; phone: string | null };
  /** Applicant, directors and owners from the approved KYB case (names come from documents/registries). */
  people?: PackagePerson[];
  /** Account used to return funds if a payment bounces; partners that onboard by API require it. */
  returnBank?: { accountName: string; accountNumber: string; bankCountry: string; currency: string; routingType: string; routingValue: string; bankName?: string };
  /** Consent and the device that gave it (a partner's declaration and fraud checks). */
  consent?: { acceptedAt: string; ip?: string; deviceInfo?: string; sessionId?: string };
  /** Documents already uploaded at the partner (its file ids), by its document type. */
  documents?: { type: string; fileIds: string[] }[];
  /** Verified business documents held (encrypted) by Vaulte that the partner may need, loaded only when the adapter sends them. `kind` is Vaulte's document type. */
  documentFiles?: { kind: string; filename: string; mime: string; load: () => Promise<Buffer> }[];
}
export interface PackagePerson {
  role: "APPLICANT" | "UBO" | "DIRECTOR" | "SIGNATORY";
  firstName: string; lastName: string; dateOfBirth: string | null; nationality: string | null; ownershipPct: number | null;
  email: string | null; phone: string | null; phoneCountryCode: string | null;
  address: { line1: string; line2?: string; city: string; state?: string; postcode: string; country: string } | null;
}
/** A settled credit on a customer's account at the partner; `id` is the partner's own reference and is used for de-duplication. */
export interface PartnerCredit { id: string; currency: string; amountMinor: bigint; senderName?: string; bankReference?: string; at?: string }
export interface PartnerPayoutStatus { state: "PAID" | "FAILED" | "PENDING"; reason?: string; /** The partner's own fee for this payout, in the source currency's minor units, when it reports one. */ feeMinor?: bigint; feeCurrency?: string }
/** A question the partner's compliance team put to the customer (an RFI). Rendered and answered inside Vaulte; documents are forwarded, never stored. */
export interface InfoRequestField { key: string; label: string; kind: "text" | "date" | "file" }
export interface InfoRequest { id: string; title: string; remarks?: string; /** A hosted step the partner wants completed instead of a form. */ url?: string; status: "OPEN" | "ANSWERED"; fields: InfoRequestField[] }
export interface InfoAnswer { values: Record<string, string>; files: Record<string, { name: string; mime: string; dataBase64: string }> }
export type PartnerCustomerState = "SUBMITTED" | "NEEDS_INFO" | "APPROVED" | "REJECTED";
export interface PartnerCustomerResult { partnerRef: string; status: PartnerCustomerState; note?: string; /** A step only the partner can complete (its hosted KYC or RFI form). */ actionUrl?: string }

export interface StablecoinPartner {
  readonly id: string;
  /** Optional: onboard the customer at the partner (Vaulte's KYB package in, partner's decision out). Partners without an API are handled by staff after the partner confirms. */
  submitCustomer?(pkg: CustomerPackage): Promise<PartnerCustomerResult>;
  /** Optional: poll the partner's decision for a previously submitted customer. */
  getCustomerStatus?(partnerRef: string): Promise<PartnerCustomerResult>;
  createDeposit(opts: { transferId: string; token: Token; chain: Chain; expectedAmountMicro: bigint }): Promise<DepositInstruction>;
  createFiatFunding(opts: { transferId: string; currency: string; amountMinor: bigint; customerRef?: string }): Promise<FiatFundingInstruction>;
  createPayout(req: PayoutRequest): Promise<PayoutResult>;
  createVirtualAccount(req: VirtualAccountRequest): Promise<VirtualAccountResult>;
  /** Optional: certificates/confirmations the partner holds for a payout it made. Polled by the certificate job; nothing is trusted as verified unless the partner is. */
  listDocuments?(q: { partnerRef: string | null; transferId: string; destCountry: string; purposeCode: string | null; completedAt: Date | null }): Promise<PartnerDocument[]>;
  /** Optional: open questions the partner has for this customer, and a way to answer one. */
  listInfoRequests?(partnerRef: string): Promise<InfoRequest[]>;
  answerInfoRequest?(partnerRef: string, requestId: string, answer: InfoAnswer): Promise<void>;
  /** Optional: credits that reached the customer's own account at the partner since a time. Polled so a missed webhook never leaves a payment waiting. */
  listFundsReceived?(customerRef: string, since: Date): Promise<PartnerCredit[]>;
  /** Optional: where a payout stands at the partner, for the same reason (webhooks may be delivered at most once). */
  getPayoutStatus?(partnerRef: string, customerRef?: string): Promise<PartnerPayoutStatus>;
  verifyWebhook(rawBody: string, headers: Headers, url?: URL): boolean;
  /** Convert the partner's own webhook payload into Vaulte's event shape ({id, type, data}); null = not relevant. */
  normalizeWebhook?(payload: unknown, headers?: Headers): { id: string; type: string; data: Record<string, unknown> } | null;
}
