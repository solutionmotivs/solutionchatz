// lib/psp/currencycloud.ts
// Currencycloud API integration — SWIFT GPI + FX
// Docs: https://developer.currencycloud.com/api-reference/

const BASE = "https://devapi.currencycloud.com"; // sandbox
// Production: https://api.currencycloud.com

let sessionToken: string | null = null;
let sessionExpiry = 0;

async function getSessionToken(): Promise<string | null> {
  if (!process.env.CURRENCYCLOUD_API_KEY || !process.env.CURRENCYCLOUD_LOGIN_ID) return null;
  if (sessionToken && Date.now() < sessionExpiry) return sessionToken;

  try {
    const res = await fetch(`${BASE}/v2/authenticate/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login_id: process.env.CURRENCYCLOUD_LOGIN_ID,
        api_key: process.env.CURRENCYCLOUD_API_KEY,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json() as { auth_token: string };
    sessionToken = data.auth_token;
    sessionExpiry = Date.now() + 25 * 60 * 1000; // 25 min
    return sessionToken;
  } catch {
    return null;
  }
}

export interface CCPaymentResult {
  id: string;
  status: string;
  reference: string;
  amount: string;
  currency: string;
  createdAt: string;
}

export async function createCurrencycloudPayment(opts: {
  amount: number;           // in major units (e.g. 1275.00)
  currency: string;
  beneficiaryId: string;
  reason: string;
  reference: string;
  paymentType?: "regular" | "priority";
}): Promise<CCPaymentResult | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const res = await fetch(`${BASE}/v2/payments/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Auth-Token": token },
      body: JSON.stringify({
        currency: opts.currency,
        beneficiary_id: opts.beneficiaryId,
        amount: opts.amount.toFixed(2),
        reason: opts.reason,
        reference: opts.reference,
        payment_type: opts.paymentType ?? "priority",
        unique_request_id: opts.reference,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json() as {
      id: string; status: string; reference: string;
      amount: string; currency: string; created_at: string;
    };

    return {
      id: data.id,
      status: data.status,
      reference: data.reference,
      amount: data.amount,
      currency: data.currency,
      createdAt: data.created_at,
    };
  } catch {
    return null;
  }
}

export async function getCurrencycloudRate(opts: {
  buyCurrency: string;
  sellCurrency: string;
  fixedSide: "buy" | "sell";
  amount: number;
}): Promise<{ rate: number; clientRate: number } | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const res = await fetch(`${BASE}/v2/rates/detailed?` + new URLSearchParams({
      buy_currency: opts.buyCurrency,
      sell_currency: opts.sellCurrency,
      fixed_side: opts.fixedSide,
      amount: opts.amount.toFixed(2),
    }), {
      headers: { "X-Auth-Token": token },
    });

    if (!res.ok) return null;
    const data = await res.json() as { core_rate: string; client_rate: string };
    return { rate: parseFloat(data.core_rate), clientRate: parseFloat(data.client_rate) };
  } catch {
    return null;
  }
}

// Sandbox mock — used when Currencycloud not configured
export function mockPaymentResult(reference: string): CCPaymentResult {
  return {
    id: `cc_sandbox_${Date.now()}`,
    status: "ready_to_send",
    reference,
    amount: "0",
    currency: "USD",
    createdAt: new Date().toISOString(),
  };
}
