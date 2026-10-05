// lib/email/templates.ts
// All Vaulte email templates — inline HTML, no external deps

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.vaulte.io";

function wrap(content: string, preheader = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Vaulte</title>
<style>
  body{margin:0;padding:0;background:#F4F1EB;font-family:'Courier New',monospace;color:#0A0A0F}
  .wrap{max-width:560px;margin:0 auto;padding:40px 20px}
  .card{background:#fff;border:1px solid rgba(10,10,15,0.1);padding:40px}
  .logo{font-size:22px;letter-spacing:-0.5px;margin-bottom:32px;color:#0A0A0F}
  .logo span{color:#C9A84C}
  h1{font-size:28px;font-weight:normal;letter-spacing:-0.5px;margin:0 0 16px}
  p{font-size:13px;line-height:1.8;color:#3D4A5C;margin:0 0 16px}
  .btn{display:inline-block;background:#0A0A0F;color:#F4F1EB!important;text-decoration:none;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;padding:14px 28px;margin:8px 0 24px}
  .btn-gold{background:#C9A84C;color:#0A0A0F!important}
  .amount{font-size:36px;font-weight:normal;color:#0A0A0F;letter-spacing:-1px;margin:16px 0}
  .meta{font-size:11px;color:#8C9AAD;border-top:1px solid rgba(10,10,15,0.08);padding-top:20px;margin-top:24px}
  .badge{display:inline-block;font-size:9px;letter-spacing:0.1em;text-transform:uppercase;padding:3px 10px;border:1px solid rgba(45,106,79,0.3);color:#2D6A4F;margin-bottom:16px}
  .powered{text-align:center;padding:24px 0 0;font-size:10px;color:#8C9AAD;letter-spacing:0.05em}
  .powered a{color:#C9A84C;text-decoration:none}
  table.details{width:100%;border-collapse:collapse;margin:16px 0}
  table.details td{padding:10px 0;border-bottom:1px solid rgba(10,10,15,0.06);font-size:12px;vertical-align:top}
  table.details td:first-child{color:#8C9AAD;width:40%}
  table.details td:last-child{color:#0A0A0F;font-weight:500;text-align:right}
</style>
</head>
<body>
<div class="wrap">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;color:#F4F1EB;font-size:1px">${preheader}</div>` : ""}
<div class="card">
  <div class="logo">Vaulte<span>.</span></div>
  ${content}
</div>
<div class="powered">Sent via <a href="https://vaulte.io">Vaulte</a> — B2B Payment Infrastructure</div>
</div>
</body>
</html>`;
}

// ── 1. WELCOME EMAIL ──────────────────────────────────────────────────────────
export function welcomeEmail(name: string, orgName: string, testApiKey: string): EmailTemplate {
  return {
    subject: `Welcome to Vaulte — your sandbox is ready`,
    html: wrap(`
      <div class="badge">Account Created</div>
      <h1>Welcome, ${name}.</h1>
      <p>Your Vaulte sandbox is live. You can send test payments right now — no KYB required in sandbox mode.</p>
      <a href="${BASE_URL}/dashboard" class="btn">Open Dashboard →</a>
      <p style="font-size:12px;color:#8C9AAD;margin-bottom:8px">Your test API key:</p>
      <div style="background:#0A0A0F;color:#C9A84C;font-size:11px;padding:14px 16px;word-break:break-all;margin-bottom:24px">${testApiKey}</div>
      <p>Complete KYB verification to unlock live payments. Takes ~8 minutes.</p>
      <table class="details">
        <tr><td>Organization</td><td>${orgName}</td></tr>
        <tr><td>Sandbox</td><td>✓ Active</td></tr>
        <tr><td>Live Payments</td><td>Pending KYB</td></tr>
        <tr><td>First step</td><td>Send a test payment</td></tr>
      </table>
      <div class="meta">Store your API key securely. It will not be shown again in full. Questions? Reply to this email.</div>
    `, `Welcome to Vaulte — your B2B payment sandbox is live`),
    text: `Welcome to Vaulte, ${name}.\n\nYour sandbox is ready. Test API key: ${testApiKey}\n\nOpen dashboard: ${BASE_URL}/dashboard`,
  };
}

// ── 2. INVOICE EMAIL (VIRAL LOOP) ─────────────────────────────────────────────
export function invoiceEmail(opts: {
  recipientName: string;
  senderName: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  dueDate: string | null;
  payUrl: string;
  lineItems: { description: string; quantity: number; unitPrice: number; total: number }[];
  poweredBy: boolean;
}): EmailTemplate {
  const amountFormatted = new Intl.NumberFormat("en-US", {
    style: "currency", currency: opts.currency,
  }).format(opts.amount / 100);

  const itemRows = opts.lineItems.map(li => `
    <tr>
      <td>${li.description} × ${li.quantity}</td>
      <td>${new Intl.NumberFormat("en-US", { style: "currency", currency: opts.currency }).format(li.total / 100)}</td>
    </tr>
  `).join("");

  return {
    subject: `Invoice ${opts.invoiceNumber} from ${opts.senderName} — ${amountFormatted} due`,
    html: wrap(`
      <div class="badge">Invoice Received</div>
      <h1>You have a new invoice.</h1>
      <p>${opts.senderName} has sent you invoice <strong>${opts.invoiceNumber}</strong>.</p>
      <div class="amount">${amountFormatted}</div>
      ${opts.dueDate ? `<p style="font-size:12px;color:#8C9AAD">Due: ${opts.dueDate}</p>` : ""}
      <a href="${opts.payUrl}" class="btn btn-gold">Pay Now →</a>
      <table class="details">
        <tr><td>From</td><td>${opts.senderName}</td></tr>
        <tr><td>Invoice #</td><td>${opts.invoiceNumber}</td></tr>
        <tr><td>Currency</td><td>${opts.currency}</td></tr>
        ${opts.dueDate ? `<tr><td>Due Date</td><td>${opts.dueDate}</td></tr>` : ""}
      </table>
      <table class="details" style="margin-top:16px">
        <tr><td colspan="2" style="color:#8C9AAD;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;padding-bottom:8px">Line Items</td></tr>
        ${itemRows}
        <tr><td><strong>Total</strong></td><td><strong>${amountFormatted}</strong></td></tr>
      </table>
      <div class="meta">
        Click "Pay Now" to pay securely via Vaulte.${opts.poweredBy ? " Payments processed by <a href='https://vaulte.io' style='color:#C9A84C'>Vaulte</a> — B2B payment infrastructure." : ""}
      </div>
    `, `Invoice ${opts.invoiceNumber} — ${amountFormatted} from ${opts.senderName}`),
    text: `Invoice ${opts.invoiceNumber} from ${opts.senderName}\nAmount: ${amountFormatted}\nPay here: ${opts.payUrl}`,
  };
}

// ── 3. PAYMENT SETTLED ────────────────────────────────────────────────────────
export function paymentSettledEmail(opts: {
  name: string;
  amount: number;
  currency: string;
  rail: string;
  recipientName: string;
  paymentId: string;
  settledAt: string;
}): EmailTemplate {
  const amountFormatted = new Intl.NumberFormat("en-US", {
    style: "currency", currency: opts.currency,
  }).format(opts.amount / 100);

  return {
    subject: `✓ Payment settled — ${amountFormatted} to ${opts.recipientName}`,
    html: wrap(`
      <div class="badge">Payment Settled</div>
      <h1>Payment confirmed.</h1>
      <div class="amount">${amountFormatted}</div>
      <p>Your payment to <strong>${opts.recipientName}</strong> has been settled successfully.</p>
      <a href="${BASE_URL}/dashboard" class="btn">View in Dashboard →</a>
      <table class="details">
        <tr><td>Payment ID</td><td>${opts.paymentId}</td></tr>
        <tr><td>Amount</td><td>${amountFormatted}</td></tr>
        <tr><td>Recipient</td><td>${opts.recipientName}</td></tr>
        <tr><td>Rail</td><td>${opts.rail}</td></tr>
        <tr><td>Settled At</td><td>${opts.settledAt}</td></tr>
      </table>
      <div class="meta">This payment is final and irrevocable. Keep this email for your records.</div>
    `, `Payment of ${amountFormatted} to ${opts.recipientName} has settled`),
    text: `Payment settled: ${amountFormatted} to ${opts.recipientName}. Payment ID: ${opts.paymentId}`,
  };
}

// ── 4. KYB APPROVED ───────────────────────────────────────────────────────────
export function kybApprovedEmail(name: string, orgName: string): EmailTemplate {
  return {
    subject: `✓ KYB Approved — Live payments unlocked for ${orgName}`,
    html: wrap(`
      <div class="badge">KYB Approved</div>
      <h1>You're live, ${name}.</h1>
      <p>Your business verification is complete. Live payments are now unlocked for <strong>${orgName}</strong>.</p>
      <p>You can now process real payments via SWIFT, SEPA, ACH, UPI and all supported rails.</p>
      <a href="${BASE_URL}/dashboard" class="btn btn-gold">Start Processing Payments →</a>
      <table class="details">
        <tr><td>Status</td><td>✓ Approved</td></tr>
        <tr><td>Sanctions screening</td><td>✓ Passed</td></tr>
        <tr><td>Live payments</td><td>✓ Unlocked</td></tr>
      </table>
      <div class="meta">Your risk tier is STANDARD. For volume above $5M/month, contact support for enhanced limits.</div>
    `, `KYB approved — live payments unlocked`),
    text: `KYB Approved for ${orgName}. Live payments are now unlocked. Open dashboard: ${BASE_URL}/dashboard`,
  };
}

// ── 5. KYB REJECTED ───────────────────────────────────────────────────────────
export function kybRejectedEmail(name: string, reason: string): EmailTemplate {
  return {
    subject: `KYB Review — Action required`,
    html: wrap(`
      <h1>KYB review update.</h1>
      <p>Hi ${name}, we were unable to complete your business verification at this time.</p>
      <p style="background:#FFF3CD;padding:12px 16px;border-left:3px solid #C9A84C;font-size:12px"><strong>Reason:</strong> ${reason}</p>
      <p>Please review the issue and resubmit your KYB application with corrected information.</p>
      <a href="${BASE_URL}/onboarding" class="btn">Resubmit KYB →</a>
      <div class="meta">If you believe this is an error, reply to this email with your company registration number.</div>
    `, `KYB review update — action required`),
    text: `KYB review: ${reason}. Resubmit at: ${BASE_URL}/onboarding`,
  };
}

// ── 6. PAYMENT FAILED ─────────────────────────────────────────────────────────
export function paymentFailedEmail(opts: {
  name: string;
  amount: number;
  currency: string;
  paymentId: string;
  reason: string;
}): EmailTemplate {
  const amountFormatted = new Intl.NumberFormat("en-US", {
    style: "currency", currency: opts.currency,
  }).format(opts.amount / 100);

  return {
    subject: `Payment failed — ${amountFormatted}`,
    html: wrap(`
      <h1>Payment failed.</h1>
      <div class="amount" style="color:#C1121F">${amountFormatted}</div>
      <p style="background:#FFF0F0;padding:12px 16px;border-left:3px solid #C1121F;font-size:12px"><strong>Reason:</strong> ${opts.reason}</p>
      <p>No funds have been debited. You can retry the payment from your dashboard.</p>
      <a href="${BASE_URL}/dashboard" class="btn">Retry Payment →</a>
      <table class="details">
        <tr><td>Payment ID</td><td>${opts.paymentId}</td></tr>
        <tr><td>Amount</td><td>${amountFormatted}</td></tr>
        <tr><td>Status</td><td>Failed</td></tr>
      </table>
      <div class="meta">If this issue persists, contact support with your Payment ID.</div>
    `, `Payment of ${amountFormatted} failed`),
    text: `Payment failed: ${amountFormatted}. Reason: ${opts.reason}. Payment ID: ${opts.paymentId}`,
  };
}
