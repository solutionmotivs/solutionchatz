import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(
  amountMinorUnits: number | bigint,
  currency: string,
  locale = "en-US"
): string {
  const amount =
    typeof amountMinorUnits === "bigint"
      ? Number(amountMinorUnits)
      : amountMinorUnits;

  const decimalPlaces = ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
  const divisor = decimalPlaces === 0 ? 1 : 100;

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  }).format(amount / divisor);
}

// Currencies that don't use decimal places
const ZERO_DECIMAL_CURRENCIES = new Set([
  "JPY", "KRW", "VND", "IDR", "HUF", "TWD", "ISK",
]);

export function minorUnitsToFloat(amount: bigint | number, currency: string): number {
  const n = typeof amount === "bigint" ? Number(amount) : amount;
  if (ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())) return n;
  return n / 100;
}

export function floatToMinorUnits(amount: number, currency: string): bigint {
  if (ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())) return BigInt(Math.round(amount));
  return BigInt(Math.round(amount * 100));
}

export function formatDatetime(date: Date | string | null): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${diffDay}d ago`;
}

export function generateIdempotencyKey(): string {
  const { v4: uuidv4 } = require("uuid");
  return `idm_${uuidv4().replace(/-/g, "")}`;
}

export function maskApiKey(keyPrefix: string): string {
  return `${keyPrefix}${"•".repeat(32)}`;
}

export function statusToColor(status: string): string {
  const map: Record<string, string> = {
    SETTLED: "text-v-green-light",
    COMPLIANCE_CLEARED: "text-v-green-light",
    PROCESSING: "text-gold",
    PENDING_COMPLIANCE: "text-gold",
    DRAFT: "text-mist",
    FAILED: "text-v-red",
    CANCELLED: "text-mist",
    RECALLED: "text-rust",
  };
  return map[status] ?? "text-mist";
}

export function railToLabel(rail: string): string {
  const map: Record<string, string> = {
    SWIFT_GPI: "SWIFT GPI",
    SEPA_INSTANT: "SEPA Instant",
    SEPA_CREDIT: "SEPA Credit",
    ACH_SAME_DAY: "ACH Same-Day",
    ACH_STANDARD: "ACH Standard",
    FEDNOW: "FedNow",
    UPI: "UPI",
    RTGS: "RTGS",
    NEFT: "NEFT",
    AUTO: "Auto",
  };
  return map[rail] ?? rail;
}

export function sanitizeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

// API response helpers
export function apiSuccess<T>(data: T, status = 200) {
  return Response.json(data, { status });
}

export function apiError(
  code: string,
  message: string,
  status = 400,
  param?: string
) {
  return Response.json(
    {
      error: {
        code,
        message,
        ...(param ? { param } : {}),
        doc_url: `https://docs.vaulte.io/errors/${code.toLowerCase()}`,
      },
    },
    { status }
  );
}
