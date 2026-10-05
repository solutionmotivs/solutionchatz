// types/index.ts
// Vaulte — Global TypeScript Types

export type Currency =
  | "USD" | "EUR" | "GBP" | "INR" | "SGD" | "AED"
  | "CHF" | "JPY" | "CAD" | "AUD" | "SEK" | "NOK"
  | "MYR" | "THB" | "IDR" | "PHP" | "KES" | "NGN"
  | "EGP" | "SAR" | "QAR" | "KWD";

export type PaymentRailType =
  | "SWIFT_GPI" | "SEPA_INSTANT" | "SEPA_CREDIT"
  | "ACH_SAME_DAY" | "ACH_STANDARD" | "FEDNOW"
  | "UPI" | "RTGS" | "NEFT" | "AUTO";

export type PaymentStatusType =
  | "DRAFT" | "PENDING_COMPLIANCE" | "COMPLIANCE_CLEARED"
  | "PROCESSING" | "SETTLED" | "FAILED" | "CANCELLED" | "RECALLED";

export type KYBStatusType =
  | "NOT_STARTED" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "NEEDS_MORE_INFO";

export type RiskTierType = "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";

// API Request / Response types

export interface CreatePaymentRequest {
  amount: number;          // in minor units
  currency: Currency;
  rail?: PaymentRailType;
  sender: {
    entity_id: string;
    account_id?: string;
  };
  recipient: {
    entity_id: string;
    account_id?: string;
  };
  invoice_id?: string;
  idempotency_key?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentResponse {
  id: string;
  status: PaymentStatusType;
  amount: number;
  currency: string;
  rail_selected: PaymentRailType | null;
  estimated_arrival: string | null;
  compliance_cleared: boolean;
  fx_rate: number;
  fee: number;
  network_fee: number;
  external_ref: string | null;
  created_at: string;
  settled_at: string | null;
  metadata: Record<string, unknown> | null;
}

export interface CreateInvoiceRequest {
  number: string;
  currency: Currency;
  issuer_entity_id?: string;
  payer_entity_id?: string;
  due_date?: string;
  line_items: {
    description: string;
    quantity: number;
    unit_price: number;
    tax_rate?: number;
  }[];
  notes?: string;
}

export interface KYBSubmitRequest {
  legal_name: string;
  country: string;             // ISO 3166-1 alpha-2
  registration_number: string;
  tax_id?: string;
  business_type: string;
  website?: string;
  ubos: {
    name: string;
    nationality?: string;
    ownership_pct: number;
    id_document?: string;      // base64
  }[];
}

export interface FxRateResponse {
  base: Currency;
  timestamp: string;
  rates: Partial<Record<Currency, number>>;
  spread: number;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    param?: string;
    doc_url?: string;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  has_more: boolean;
  total: number;
  page: number;
  per_page: number;
}

// Dashboard types
export interface DashboardStats {
  totalVolumeUsd: number;
  totalPayments: number;
  settledPayments: number;
  failedPayments: number;
  pendingPayments: number;
  avgProcessingTimeMs: number;
  fxSavingsUsd: number;
}

export interface RecentTransaction {
  id: string;
  senderName: string;
  recipientName: string;
  amount: number;
  currency: string;
  amountUsd: number;
  status: PaymentStatusType;
  rail: PaymentRailType | null;
  createdAt: string;
}

// Auth
export interface JWTPayload {
  sub: string;      // userId
  org: string;      // organizationId
  role: string;
  sid: string;      // session id (revocable server-side)
  iat: number;
  exp: number;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  organizationId: string;
  organizationName: string;
  kybStatus: KYBStatusType;
  sessionId: string;
  isStaff: boolean;
  emailVerified: boolean;
  totpEnabled: boolean;
  accountType: "BUSINESS" | "INDIVIDUAL";
}
