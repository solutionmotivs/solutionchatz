"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface PayView {
  status: string;
  message: string;
  token: string | null;
  chain: string | null;
  funding_instructions: null | { address?: string; chain?: string; token?: string; amount_token?: string; expires_at?: string; warning?: string };
  confirmations: number;
  reference: string;
}

interface Props {
  payToken: string;
  invoice: {
    id: string; number: string; status: string; currency: string;
    totalAmount: number; subtotal: number; taxAmount: number;
    dueDate: string | null; notes: string | null; recipientName: string | null;
    organizationName: string; poweredBy: boolean;
    lineItems: { description: string; quantity: number; unitPrice: number; taxRate: number; total: number }[];
  };
}

const isPaid = (status: string) => status === "PAID";

export default function PublicPayPage({ invoice, payToken }: Props) {
  const [payStep, setPayStep] = useState<"view" | "details" | "processing" | "instructions">("view");
  const [form, setForm] = useState({ companyName: "", email: "", country: "US", token: "USDC" });
  const [pay, setPay] = useState<PayView | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll the payment status while a payment is open.
  useEffect(() => {
    if (payStep !== "instructions" || !pay) return;
    if (["COMPLETED", "FAILED", "CANCELLED", "EXPIRED"].includes(pay.status)) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/pay/${payToken}/status`);
        if (res.ok) setPay(await res.json());
      } catch { /* keep polling */ }
    }, 5000);
    return () => clearInterval(id);
  }, [payStep, pay, payToken]);

  const fmt = (n: number) => new Intl.NumberFormat("en-US", {
    style: "currency", currency: invoice.currency,
  }).format(n / 100);

  const paid = isPaid(invoice.status);

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPayStep("processing");
    try {
      const res = await fetch(`/api/pay/${payToken}/intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payer_name: form.companyName, payer_email: form.email, payer_country: form.country, token: form.token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Could not start the payment");
        setPayStep("details");
        return;
      }
      setPay(data);
      setPayStep("instructions");
    } catch {
      setError("Network error. Please try again.");
      setPayStep("details");
    }
  }

  return (
    <div className="min-h-screen bg-paper flex flex-col">
      {/* Top bar */}
      <div className="border-b border-ink/8 px-6 py-4 flex items-center justify-between">
        <div className="font-serif text-lg text-ink">Vaulte</div>
        <div className="font-mono text-[9px] uppercase tracking-widest text-mist flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-v-green-light" />
          Secure Payment
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center py-12 px-4">
        <div className="w-full max-w-[680px]">

          {pay?.status === "COMPLETED" ? (
            <div className="text-center py-16">
              <div className="text-v-green-light text-5xl mb-6">✓</div>
              <h1 className="font-serif text-4xl text-ink mb-3">Payment Received.</h1>
              <p className="font-mono text-xs text-mist mb-8">
                The recipient has been paid {fmt(invoice.totalAmount)} for this invoice.
              </p>
              <div className="inline-block border border-ink/10 px-6 py-4">
                <div className="font-mono text-[9px] uppercase tracking-widest text-mist mb-1">Payment Reference</div>
                <div className="font-mono text-xs text-ink">{invoice.number}-{pay?.reference}</div>
              </div>
              {invoice.poweredBy && (
                <p className="mt-8 font-mono text-[9px] text-mist">
                  Processed by <a href="https://vaulte.io" className="text-gold hover:underline">Vaulte</a> — B2B Payment Infrastructure
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-[1fr_340px] gap-8 items-start">
              {/* Invoice detail */}
              <div>
                <div className="section-tag mb-4">Invoice from {invoice.organizationName}</div>
                <div className="flex items-start justify-between mb-8">
                  <div>
                    <h1 className="font-serif text-4xl text-ink mb-1">{fmt(invoice.totalAmount)}</h1>
                    <div className="font-mono text-[10px] text-mist">Invoice #{invoice.number}</div>
                    {invoice.dueDate && (
                      <div className="font-mono text-[10px] text-mist mt-1">
                        Due: {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(invoice.dueDate))}
                      </div>
                    )}
                  </div>
                  <span className={cn(
                    "status-pill",
                    paid ? "status-settled" : invoice.status === "SENT" ? "status-pending" : "status-draft"
                  )}>
                    {invoice.status.replace(/_/g, " ")}
                  </span>
                </div>

                {/* Line items */}
                <div className="border border-ink/10">
                  <div className="grid grid-cols-[1fr_auto] px-4 py-2.5 bg-cream/60 border-b border-ink/8">
                    <span className="font-mono text-[9px] uppercase tracking-widest text-mist">Description</span>
                    <span className="font-mono text-[9px] uppercase tracking-widest text-mist">Amount</span>
                  </div>
                  {invoice.lineItems.map((li, i) => (
                    <div key={i} className="grid grid-cols-[1fr_auto] px-4 py-4 border-b border-ink/5">
                      <div>
                        <div className="font-mono text-xs text-ink">{li.description}</div>
                        <div className="font-mono text-[10px] text-mist mt-0.5">
                          Qty: {li.quantity} × {fmt(li.unitPrice)}
                          {li.taxRate > 0 && ` + ${li.taxRate}% tax`}
                        </div>
                      </div>
                      <div className="font-serif text-base text-ink">{fmt(li.total)}</div>
                    </div>
                  ))}
                  <div className="px-4 py-4 space-y-2">
                    <div className="flex justify-between font-mono text-xs text-mist">
                      <span>Subtotal</span><span>{fmt(invoice.subtotal)}</span>
                    </div>
                    {invoice.taxAmount > 0 && (
                      <div className="flex justify-between font-mono text-xs text-mist">
                        <span>Tax</span><span>{fmt(invoice.taxAmount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-mono text-sm text-ink border-t border-ink/8 pt-2 mt-2">
                      <span className="font-bold">Total</span>
                      <span className="font-serif text-lg">{fmt(invoice.totalAmount)}</span>
                    </div>
                  </div>
                </div>

                {invoice.notes && (
                  <div className="mt-4 p-4 border border-ink/8 bg-cream/40">
                    <div className="font-mono text-[9px] uppercase tracking-widest text-mist mb-2">Notes</div>
                    <div className="font-mono text-xs text-slate leading-relaxed">{invoice.notes}</div>
                  </div>
                )}
              </div>

              {/* Pay panel */}
              <div className="border border-ink/10 p-6 sticky top-8">
                {paid ? (
                  <div className="text-center py-8">
                    <div className="text-v-green-light text-3xl mb-3">✓</div>
                    <div className="font-display font-bold text-sm text-ink">Invoice Paid</div>
                    <div className="font-mono text-[10px] text-mist mt-1">No action required.</div>
                  </div>
                ) : payStep === "view" ? (
                  <>
                    <div className="font-mono text-[9px] uppercase tracking-widest text-mist mb-4">Pay This Invoice</div>
                    <div className="font-serif text-3xl text-ink mb-1">{fmt(invoice.totalAmount)}</div>
                    <div className="font-mono text-[10px] text-mist mb-6">to {invoice.organizationName}</div>

                    <div className="space-y-2 mb-6">
                      {[
                        { icon: "🔒", text: "Funds are held by a licensed payment partner" },
                        { icon: "⚡", text: "Pay with USDC or USDT" },
                        { icon: "📄", text: "Recipient is paid in " + invoice.currency + " in their bank" },
                      ].map(item => (
                        <div key={item.text} className="flex items-center gap-3 font-mono text-[10px] text-slate">
                          <span>{item.icon}</span>{item.text}
                        </div>
                      ))}
                    </div>

                    <button onClick={() => setPayStep("details")} className="btn-gold w-full">
                      Pay {fmt(invoice.totalAmount)} →
                    </button>

                    {invoice.poweredBy && (
                      <p className="mt-4 font-mono text-[9px] text-mist text-center leading-relaxed">
                        Powered by <a href="https://vaulte.io" className="text-gold hover:underline" target="_blank" rel="noopener noreferrer">Vaulte</a>
                        <br/>B2B Payment Infrastructure
                      </p>
                    )}
                  </>
                ) : payStep === "processing" ? (
                  <div className="text-center py-10">
                    <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <div className="font-mono text-xs text-mist">Preparing your payment...</div>
                  </div>
                ) : payStep === "instructions" && pay ? (
                  <div className="space-y-4">
                    <div className="font-mono text-[9px] uppercase tracking-widest text-mist">Payment status</div>
                    <div className="font-mono text-xs text-ink leading-relaxed">{pay.message}</div>
                    {pay.funding_instructions?.address && (
                      <div className="border border-ink/10 p-4 space-y-3">
                        <div>
                          <div className="label-text">Send exactly</div>
                          <div className="font-serif text-2xl text-ink">{pay.funding_instructions.amount_token} {pay.funding_instructions.token}</div>
                        </div>
                        <div>
                          <div className="label-text">Network</div>
                          <div className="font-mono text-xs text-ink uppercase">{pay.funding_instructions.chain}</div>
                        </div>
                        <div>
                          <div className="label-text">Deposit address</div>
                          <div className="font-mono text-[11px] text-ink break-all select-all">{pay.funding_instructions.address}</div>
                        </div>
                        {pay.funding_instructions.expires_at && (
                          <div className="font-mono text-[10px] text-mist">
                            Expires {new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(new Date(pay.funding_instructions.expires_at))}
                          </div>
                        )}
                        {pay.funding_instructions.warning && (
                          <div className="font-mono text-[10px] text-rust leading-relaxed">{pay.funding_instructions.warning}</div>
                        )}
                      </div>
                    )}
                    {["FAILED", "CANCELLED", "EXPIRED"].includes(pay.status) && (
                      <button onClick={() => { setPay(null); setPayStep("details"); }} className="btn-ghost w-full text-[10px]">Start again</button>
                    )}
                    <div className="font-mono text-[9px] text-mist">Reference: {pay.reference}</div>
                  </div>
                ) : (
                  <form onSubmit={handlePay} className="space-y-4">
                    <div className="font-mono text-[9px] uppercase tracking-widest text-mist mb-4">Your Details</div>
                    <div>
                      <label className="label-text">Company Name</label>
                      <input className="input-field" value={form.companyName}
                        onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))}
                        placeholder="Your Company Ltd." required />
                    </div>
                    <div>
                      <label className="label-text">Email for Receipt</label>
                      <input type="email" className="input-field" value={form.email}
                        onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                        placeholder="accounts@yourcompany.com" required />
                    </div>
                    <div>
                      <label className="label-text">Country of your company</label>
                      <select className="input-field" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))}>
                        {[["US","United States"],["GB","United Kingdom"],["DE","Germany"],["FR","France"],["NL","Netherlands"],["AE","UAE"],["SG","Singapore"],["CA","Canada"],["AU","Australia"]].map(([c, n]) => (
                          <option key={c} value={c}>{n}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label-text">Pay with</label>
                      <select className="input-field" value={form.token} onChange={e => setForm(f => ({ ...f, token: e.target.value }))}>
                        <option value="USDC">USDC</option>
                        <option value="USDT">USDT (not available for EU companies)</option>
                      </select>
                    </div>
                    {error && <div className="font-mono text-[10px] text-rust">{error}</div>}
                    <button type="submit" className="btn-gold w-full">
                      Continue →
                    </button>
                    <button type="button" onClick={() => setPayStep("view")}
                      className="btn-ghost w-full text-[10px]">
                      ← Back
                    </button>
                    <p className="font-mono text-[9px] text-mist leading-relaxed">
                      A licensed payment partner receives your stablecoin and pays the recipient in their bank.
                      Vaulte does not hold your funds. Your company may be verified before payment details are shown.
                    </p>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
