import type { Transfer, StablecoinDeposit } from "@prisma/client";

/** What an anonymous payer may see: status and how to pay, nothing about routes, fees split or internals. */
export function publicPayView(t: Transfer & { deposits?: StablecoinDeposit[] }) {
  const f = (t.fundingInstructions ?? null) as Record<string, unknown> | null;
  const messages: Record<string, string> = {
    PENDING_VERIFICATION: "We are verifying your company with our payment partner. This page updates automatically.",
    AWAITING_FUNDS: "Send the exact amount below. This page updates automatically once the network confirms it.",
    FUNDS_DETECTED: "Payment received. Converting and paying out now.",
    PAYING_OUT: "Payment received. The recipient is being paid now.",
    COMPLETED: "Done. The recipient has been paid.",
    QUARANTINED: "Your payment is under a short review. No action needed unless we contact you.",
    FAILED: "The payment could not be completed. Any funds received will be returned to you.",
    CANCELLED: "This payment was cancelled.",
    EXPIRED: "This payment request expired. Please start again.",
  };
  return {
    status: t.status,
    message: messages[t.status] ?? "",
    token: t.token,
    chain: t.chain,
    funding_instructions: t.status === "AWAITING_FUNDS" ? f : null,
    confirmations: t.deposits?.[0]?.confirmations ?? 0,
    completed_at: t.completedAt?.toISOString() ?? null,
    reference: t.id.slice(-10).toUpperCase(),
  };
}
