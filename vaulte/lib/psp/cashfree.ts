// lib/psp/cashfree.ts
// Cashfree Payouts API — UPI, RTGS, NEFT, IMPS
// Docs: https://docs.cashfree.com/docs/payout-integration-guide

const BASE = process.env.CASHFREE_ENV === "production"
  ? "https://payout-api.cashfree.com"
  : "https://payout-gamma.cashfree.com";

let cfToken: string | null = null;
let cfTokenExpiry = 0;

async function getCashfreeToken(): Promise<string | null> {
  if (!process.env.CASHFREE_APP_ID || !process.env.CASHFREE_SECRET_KEY) return null;
  if (cfToken && Date.now() < cfTokenExpiry) return cfToken;

  try {
    const res = await fetch(`${BASE}/payout/v1/authorize`, {
      method: "POST",
      headers: {
        "X-Client-Id": process.env.CASHFREE_APP_ID,
        "X-Client-Secret": process.env.CASHFREE_SECRET_KEY,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) return null;
    const data = await res.json() as { data?: { token: string; expiry: string } };
    if (!data.data?.token) return null;

    cfToken = data.data.token;
    cfTokenExpiry = new Date(data.data.expiry).getTime() - 5 * 60 * 1000;
    return cfToken;
  } catch {
    return null;
  }
}

export interface CashfreePayoutResult {
  referenceId: string;
  status: string;
  utr?: string;
}

export async function createCashfreePayout(opts: {
  amount: number;           // INR, in major units
  accountNumber: string;
  ifsc: string;
  name: string;
  transferId: string;       // unique per transfer
  mode: "UPI" | "RTGS" | "NEFT" | "IMPS";
  upiId?: string;
}): Promise<CashfreePayoutResult | null> {
  const token = await getCashfreeToken();
  if (!token) return null;

  try {
    const res = await fetch(`${BASE}/payout/v1.2/directTransfer`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: opts.amount,
        transferId: opts.transferId,
        transferMode: opts.mode,
        remarks: `Vaulte transfer ${opts.transferId}`,
        beneDetails: {
          name: opts.name,
          bankAccount: opts.accountNumber,
          ifsc: opts.ifsc,
          ...(opts.upiId ? { vpa: opts.upiId } : {}),
        },
      }),
    });

    if (!res.ok) return null;
    const data = await res.json() as {
      data?: { referenceId: string; status: string; utr?: string };
    };
    if (!data.data) return null;

    return {
      referenceId: data.data.referenceId,
      status: data.data.status,
      utr: data.data.utr,
    };
  } catch {
    return null;
  }
}

// Sandbox mock
export function mockCashfreeResult(transferId: string): CashfreePayoutResult {
  return {
    referenceId: `cf_sandbox_${Date.now()}`,
    status: "SUCCESS",
    utr: `SANDBOX${Date.now()}`,
  };
}
