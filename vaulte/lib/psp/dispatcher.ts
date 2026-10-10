// lib/psp/dispatcher.ts
// Routes payments to correct PSP based on rail + sandbox mode

import { createCurrencycloudPayment, mockPaymentResult } from "./currencycloud";
import { createCashfreePayout, mockCashfreeResult } from "./cashfree";
import type { PaymentRailType } from "@/types";

export interface DispatchResult {
  success: boolean;
  externalRef?: string;
  psp?: string;
  raw?: unknown;
  error?: string;
  isMock?: boolean;
}

export async function dispatchPayment(opts: {
  paymentId: string;
  rail: PaymentRailType;
  amount: bigint;
  currency: string;
  isSandbox: boolean;
  recipientDetails: {
    name: string;
    accountNumber?: string;
    ifsc?: string;
    upiId?: string;
    swiftBic?: string;
    iban?: string;
  };
}): Promise<DispatchResult> {
  const { paymentId, rail, amount, currency, isSandbox, recipientDetails } = opts;
  const reference = `VAULTE-${paymentId.slice(-12).toUpperCase()}`;

  // ── SANDBOX MODE ────────────────────────────────────────────────────────────
  if (isSandbox) {
    // Simulate processing delay
    await new Promise(r => setTimeout(r, 800));
    return {
      success: true,
      externalRef: `SANDBOX-${Date.now()}`,
      psp: "sandbox",
      isMock: true,
    };
  }

  // ── INDIA RAILS ─────────────────────────────────────────────────────────────
  if (["UPI", "RTGS", "NEFT"].includes(rail) && currency === "INR") {
    if (!process.env.CASHFREE_APP_ID) {
      // Fallback mock if not configured
      const mock = mockCashfreeResult(paymentId);
      return { success: true, externalRef: mock.referenceId, psp: "cashfree_mock", isMock: true };
    }

    const result = await createCashfreePayout({
      amount: Number(amount) / 100,
      accountNumber: recipientDetails.accountNumber ?? "",
      ifsc: recipientDetails.ifsc ?? "",
      name: recipientDetails.name,
      transferId: paymentId,
      mode: rail as "UPI" | "RTGS" | "NEFT",
      upiId: recipientDetails.upiId,
    });

    if (!result) return { success: false, error: "Cashfree dispatch failed", psp: "cashfree" };
    return { success: true, externalRef: result.referenceId, psp: "cashfree", raw: result };
  }

  // ── SWIFT / SEPA / ACH ──────────────────────────────────────────────────────
  if (!process.env.CURRENCYCLOUD_API_KEY) {
    const mock = mockPaymentResult(reference);
    return { success: true, externalRef: mock.id, psp: "currencycloud_mock", isMock: true };
  }

  const ccResult = await createCurrencycloudPayment({
    amount: Number(amount) / 100,
    currency,
    beneficiaryId: recipientDetails.swiftBic ?? recipientDetails.iban ?? "beneficiary_placeholder",
    reason: "B2B invoice payment via Vaulte",
    reference,
    paymentType: ["SEPA_INSTANT", "FEDNOW", "ACH_SAME_DAY"].includes(rail) ? "priority" : "regular",
  });

  if (!ccResult) return { success: false, error: "Currencycloud dispatch failed", psp: "currencycloud" };
  return { success: true, externalRef: ccResult.id, psp: "currencycloud", raw: ccResult };
}
