import { fmtMinor } from "@/lib/currency";
// lib/email/templates.ts
// All Vaulte email templates — inline HTML, no external deps

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.vaulte.io";

/** Escape user-supplied text before putting it in HTML (prevents HTML/link injection in emails). */
export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

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
export function welcomeEmail(name: string, orgName: string): EmailTemplate {
  return {
    subject: `Welcome to Vaulte`,
    html: wrap(`
      <div class="badge">Account Verified</div>
      <h1>Welcome, ${esc(name)}.</h1>
      <p>Your Vaulte sandbox is ready. You can try quotes and test transfers right now. Live payments unlock after verification by our licensed partners.</p>
      <a href="${BASE_URL}/dashboard" class="btn">Open Dashboard →</a>
      <table class="details">
        <tr><td>Account</td><td>${esc(orgName)}</td></tr>
        <tr><td>Sandbox</td><td>Active</td></tr>
        <tr><td>Live payments</td><td>After verification</td></tr>
      </table>
      <div class="meta">For your security we never email API keys. Create and manage keys in your dashboard.</div>
    `, `Welcome to Vaulte`),
    text: `Welcome to Vaulte, ${name}.\n\nYour sandbox is ready: ${BASE_URL}/dashboard\nFor your security we never email API keys.`,
  };
}

// ── 1b. ONE-TIME CODE ─────────────────────────────────────────────────────────
const OTP_LABELS: Record<string, string> = {
  SIGNUP_VERIFY: "verify your email address",
  LOGIN: "sign in to Vaulte",
  PASSWORD_RESET: "reset your password",
  EMAIL_CHANGE: "confirm your new email address",
  INVITE_ACCEPT: "accept your invitation",
};

export function otpEmail(opts: { name?: string; code: string; purpose: string; minutes: number }): EmailTemplate {
  const label = OTP_LABELS[opts.purpose] ?? "continue";
  return {
    subject: `${opts.code} is your Vaulte verification code`,
    html: wrap(`
      <h1>Your code</h1>
      <p>${opts.name ? `Hi ${esc(opts.name)}, use` : "Use"} this code to ${label}:</p>
      <div style="font-size:34px;letter-spacing:8px;background:#F4F1EB;padding:18px 0;text-align:center;margin:8px 0 20px">${esc(opts.code)}</div>
      <p>It expires in ${opts.minutes} minutes and can be used once.</p>
      <div class="meta">If you did not request this, ignore this email and do not share the code. Vaulte staff will never ask for it.</div>
    `, `Your Vaulte code is ${opts.code}`),
    text: `Your Vaulte code is ${opts.code}. Use it to ${label}. It expires in ${opts.minutes} minutes. If you did not request it, ignore this email. Never share this code.`,
  };
}

export function securityNoticeEmail(opts: { name: string; event: string; detail?: string }): EmailTemplate {
  return {
    subject: `Security notice: ${opts.event}`,
    html: wrap(`
      <h1>Security notice</h1>
      <p>Hi ${esc(opts.name)}, this is a notification about your account: <strong>${esc(opts.event)}</strong>.</p>
      ${opts.detail ? `<p>${esc(opts.detail)}</p>` : ""}
      <div class="meta">If this was not you, reset your password immediately at ${BASE_URL}/forgot-password and contact support.</div>
    `, `Security notice: ${opts.event}`),
    text: `Security notice: ${opts.event}. ${opts.detail ?? ""} If this was not you, reset your password at ${BASE_URL}/forgot-password.`,
  };
}

export function inviteEmail(opts: { inviterName: string; orgName: string; role: string; acceptUrl: string }): EmailTemplate {
  return {
    subject: `${opts.inviterName} invited you to ${opts.orgName} on Vaulte`,
    html: wrap(`
      <h1>You are invited</h1>
      <p>${esc(opts.inviterName)} invited you to join <strong>${esc(opts.orgName)}</strong> on Vaulte as <strong>${esc(opts.role)}</strong>.</p>
      <a href="${opts.acceptUrl}" class="btn">Accept invitation →</a>
      <div class="meta">This link expires in 7 days. If you were not expecting it, ignore this email.</div>
    `, `Invitation to ${opts.orgName}`),
    text: `${opts.inviterName} invited you to ${opts.orgName} on Vaulte as ${opts.role}. Accept: ${opts.acceptUrl} (expires in 7 days).`,
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
  const amountFormatted = fmtMinor(opts.amount, opts.currency);

  const itemRows = opts.lineItems.map(li => `
    <tr>
      <td>${esc(li.description)} × ${li.quantity}</td>
      <td>${fmtMinor(li.total, opts.currency)}</td>
    </tr>
  `).join("");

  return {
    subject: `Invoice ${opts.invoiceNumber} from ${opts.senderName} — ${amountFormatted} due`,
    html: wrap(`
      <div class="badge">Invoice Received</div>
      <h1>You have a new invoice.</h1>
      <p>${esc(opts.senderName)} has sent you invoice <strong>${esc(opts.invoiceNumber)}</strong>.</p>
      <div class="amount">${amountFormatted}</div>
      ${opts.dueDate ? `<p style="font-size:12px;color:#8C9AAD">Due: ${esc(opts.dueDate)}</p>` : ""}
      <a href="${opts.payUrl}" class="btn btn-gold">Pay Now →</a>
      <table class="details">
        <tr><td>From</td><td>${esc(opts.senderName)}</td></tr>
        <tr><td>Invoice #</td><td>${esc(opts.invoiceNumber)}</td></tr>
        <tr><td>Currency</td><td>${esc(opts.currency)}</td></tr>
        ${opts.dueDate ? `<tr><td>Due Date</td><td>${esc(opts.dueDate)}</td></tr>` : ""}
      </table>
      <table class="details" style="margin-top:16px">
        <tr><td colspan="2" style="color:#8C9AAD;font-size:10px;text-transform:uppercase;letter-spacing:0.1em;padding-bottom:8px">Line Items</td></tr>
        ${itemRows}
        <tr><td><strong>Total</strong></td><td><strong>${amountFormatted}</strong></td></tr>
      </table>
      <div class="meta">
        Click "Pay Now" to pay securely via Vaulte.${opts.poweredBy ? " Payments processed by <a href='https://vaulte.io' style='color:#C9A84C'>Vaulte</a> — B2B payment infrastructure." : ""}
      </div>
    `, `Invoice ${esc(opts.invoiceNumber)} — ${amountFormatted} from ${esc(opts.senderName)}`),
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
  const amountFormatted = fmtMinor(opts.amount, opts.currency);

  return {
    subject: `✓ Payment settled — ${amountFormatted} to ${opts.recipientName}`,
    html: wrap(`
      <div class="badge">Payment Settled</div>
      <h1>Payment confirmed.</h1>
      <div class="amount">${amountFormatted}</div>
      <p>Your payment to <strong>${esc(opts.recipientName)}</strong> has been settled successfully.</p>
      <a href="${BASE_URL}/dashboard" class="btn">View in Dashboard →</a>
      <table class="details">
        <tr><td>Payment ID</td><td>${esc(opts.paymentId)}</td></tr>
        <tr><td>Amount</td><td>${amountFormatted}</td></tr>
        <tr><td>Recipient</td><td>${esc(opts.recipientName)}</td></tr>
        <tr><td>Rail</td><td>${esc(opts.rail)}</td></tr>
        <tr><td>Settled At</td><td>${esc(opts.settledAt)}</td></tr>
      </table>
      <div class="meta">This payment is final and irrevocable. Keep this email for your records.</div>
    `, `Payment of ${amountFormatted} to ${esc(opts.recipientName)} has settled`),
    text: `Payment settled: ${amountFormatted} to ${opts.recipientName}. Payment ID: ${opts.paymentId}`,
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
  const amountFormatted = fmtMinor(opts.amount, opts.currency);

  return {
    subject: `Payment failed — ${amountFormatted}`,
    html: wrap(`
      <h1>Payment failed.</h1>
      <div class="amount" style="color:#C1121F">${amountFormatted}</div>
      <p style="background:#FFF0F0;padding:12px 16px;border-left:3px solid #C1121F;font-size:12px"><strong>Reason:</strong> ${esc(opts.reason)}</p>
      <p>No funds have been debited. You can retry the payment from your dashboard.</p>
      <a href="${BASE_URL}/dashboard" class="btn">Retry Payment →</a>
      <table class="details">
        <tr><td>Payment ID</td><td>${esc(opts.paymentId)}</td></tr>
        <tr><td>Amount</td><td>${amountFormatted}</td></tr>
        <tr><td>Status</td><td>Failed</td></tr>
      </table>
      <div class="meta">If this issue persists, contact support with your Payment ID.</div>
    `, `Payment of ${amountFormatted} failed`),
    text: `Payment failed: ${amountFormatted}. Reason: ${opts.reason}. Payment ID: ${opts.paymentId}`,
  };
}

// ── Verification (KYC/KYB) status update ─────────────────────────────────────
export function verificationUpdateEmail(opts: {
  name: string; subjectName: string; kind: "KYB" | "KYC";
  status: "APPROVED" | "REJECTED" | "NEEDS_INFO"; note?: string; caseId: string;
}): EmailTemplate {
  const label = opts.kind === "KYB" ? "business verification" : "identity verification";
  const head = { APPROVED: "Verification approved", REJECTED: "Verification not approved", NEEDS_INFO: "More information needed" }[opts.status];
  const body = {
    APPROVED: `The ${label} for <strong>${esc(opts.subjectName)}</strong> is complete. Your transaction limits depend on your verification level and are shown in your dashboard.`,
    REJECTED: `We could not approve the ${label} for <strong>${esc(opts.subjectName)}</strong>.`,
    NEEDS_INFO: `Our review team needs more information for the ${label} of <strong>${esc(opts.subjectName)}</strong>.`,
  }[opts.status];
  const url = `${BASE_URL}/dashboard/verification/${encodeURIComponent(opts.caseId)}`;
  return {
    subject: `${head}: ${opts.subjectName}`,
    html: wrap(`
      <h1>${head}.</h1>
      <p>Hi ${esc(opts.name)},</p>
      <p>${body}</p>
      ${opts.note ? `<p style="background:#FFF3CD;padding:12px 16px;border-left:3px solid #C9A84C;font-size:12px"><strong>Reviewer note:</strong> ${esc(opts.note)}</p>` : ""}
      <a href="${url}" class="btn">Open verification →</a>
      <div class="meta">Vaulte never asks for your password, one-time codes or full card numbers by email.</div>
    `, head),
    text: `${head}: ${opts.subjectName}. ${opts.note ? "Note: " + opts.note + ". " : ""}Open: ${url}`,
  };
}
