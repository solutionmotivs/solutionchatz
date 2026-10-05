"use client";
import { useState, useEffect } from "react";
import { formatCurrency, formatRelativeTime, railToLabel, cn } from "@/lib/utils";
import type { AuthUser } from "@/types";

interface Props {
  user: AuthUser;
  stats: { totalPayments: number; settledPayments: number; pendingPayments: number; volumeUsd: number };
  recentPayments: {
    id: string; senderName: string; recipientName: string;
    amount: number; currency: string; status: string; rail: string; createdAt: string;
  }[];
  org: { kybStatus: string; riskTier: string; planId: string; dailyLimitUsd: bigint } | null;
}

const STATUS_COLORS: Record<string, string> = {
  SETTLED: "status-settled",
  PROCESSING: "status-processing",
  COMPLIANCE_CLEARED: "status-processing",
  PENDING_COMPLIANCE: "status-pending",
  FAILED: "status-failed",
  CANCELLED: "status-cancelled",
  DRAFT: "status-draft",
};

export default function DashboardClient({ user, stats, recentPayments, org }: Props) {
  const [activeTab, setActiveTab] = useState<"overview"|"payments"|"api"|"settings">("overview");
  const [liveVolume, setLiveVolume] = useState(stats.volumeUsd);

  // Simulate live volume increment
  useEffect(() => {
    const interval = setInterval(() => {
      setLiveVolume(v => v + Math.random() * 1200 + 300);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  const kybApproved = org?.kybStatus === "APPROVED";

  return (
    <div className="min-h-screen bg-paper flex">
      {/* Sidebar */}
      <aside className="w-[220px] bg-ink flex flex-col fixed top-0 left-0 h-full z-10">
        {/* Logo */}
        <div className="px-6 py-6 border-b border-white/6">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-paper rounded-[3px] flex items-center justify-center">
              <span className="text-ink font-bold text-xs">V</span>
            </div>
            <span className="font-serif text-lg text-paper">Vaulte</span>
          </div>
        </div>

        {/* KYB banner */}
        {!kybApproved && (
          <div className="mx-4 mt-4 px-3 py-3 bg-gold/10 border border-gold/20">
            <p className="font-mono text-[9px] text-gold leading-relaxed">
              ⚠ KYB pending — live payments locked
            </p>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 px-3 py-6 space-y-1">
          {[
            { id: "overview", label: "Overview", icon: "◈" },
            { id: "payments", label: "Payments", icon: "→" },
            { id: "api", label: "API Keys", icon: "⌗" },
            { id: "settings", label: "Settings", icon: "◎" },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as typeof activeTab)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 font-mono text-xs tracking-wider text-left transition-colors",
                activeTab === item.id
                  ? "bg-white/8 text-paper"
                  : "text-white/35 hover:text-white/60 hover:bg-white/4"
              )}
            >
              <span className="text-gold text-sm">{item.icon}</span>
              {item.label}
            </button>
          ))}
          <a
            href="/dashboard/transfers"
            className="w-full flex items-center gap-3 px-3 py-2.5 font-mono text-xs tracking-wider text-left transition-colors text-white/35 hover:text-white/60 hover:bg-white/4"
          >
            <span className="text-gold text-sm">⇄</span>
            Transfers
          </a>
          <a
            href="/dashboard/integrations"
            className="w-full flex items-center gap-3 px-3 py-2.5 font-mono text-xs tracking-wider text-left transition-colors text-white/35 hover:text-white/60 hover:bg-white/4"
          >
            <span className="text-gold text-sm">⇆</span>
            Integrations
          </a>
          <a
            href="/dashboard/invoices"
            className="w-full flex items-center gap-3 px-3 py-2.5 font-mono text-xs tracking-wider text-left transition-colors text-white/35 hover:text-white/60 hover:bg-white/4"
          >
            <span className="text-gold text-sm">▤</span>
            Invoices & links
          </a>
          <a
            href="/dashboard/escrow"
            className="w-full flex items-center gap-3 px-3 py-2.5 font-mono text-xs tracking-wider text-left transition-colors text-white/35 hover:text-white/60 hover:bg-white/4"
          >
            <span className="text-gold text-sm">◇</span>
            Deals & escrow
          </a>
          <a
            href="/dashboard/statements"
            className="w-full flex items-center gap-3 px-3 py-2.5 font-mono text-xs tracking-wider text-left transition-colors text-white/35 hover:text-white/60 hover:bg-white/4"
          >
            <span className="text-gold text-sm">≡</span>
            Statements
          </a>
          <a
            href="/dashboard/verification"
            className="w-full flex items-center gap-3 px-3 py-2.5 font-mono text-xs tracking-wider text-left transition-colors text-white/35 hover:text-white/60 hover:bg-white/4"
          >
            <span className="text-gold text-sm">✓</span>
            Verification
          </a>
          <a
            href="/dashboard/profile"
            className="w-full flex items-center gap-3 px-3 py-2.5 font-mono text-xs tracking-wider text-left transition-colors text-white/35 hover:text-white/60 hover:bg-white/4"
          >
            <span className="text-gold text-sm">☺</span>
            Profile & security
          </a>
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t border-white/6">
          <div className="font-mono text-[10px] text-white/30 mb-1 truncate">{user.email}</div>
          <div className="font-mono text-[9px] text-white/20 uppercase tracking-widest">{user.role}</div>
        </div>
      </aside>

      {/* Main */}
      <main className="ml-[220px] flex-1 min-h-screen">
        {/* Top bar */}
        <div className="border-b border-ink/10 px-8 py-4 flex items-center justify-between bg-paper/90 sticky top-0 z-5 backdrop-blur-sm">
          <div>
            <h1 className="font-serif text-xl text-ink capitalize">{activeTab}</h1>
            <p className="font-mono text-[10px] text-mist">{user.organizationName}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={cn("status-pill text-[8px]",
              kybApproved ? "status-settled" : "status-pending"
            )}>
              KYB: {org?.kybStatus ?? "N/A"}
            </span>
            <span className="status-pill status-draft text-[8px]">
              {org?.planId?.toUpperCase() ?? "STARTER"}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="p-8">
          {activeTab === "overview" && (
            <OverviewTab stats={{ ...stats, volumeUsd: liveVolume }} recentPayments={recentPayments} />
          )}
          {activeTab === "payments" && <PaymentsTab payments={recentPayments} kybApproved={kybApproved} />}
          {activeTab === "api" && <ApiTab />}
          {activeTab === "settings" && <SettingsTab user={user} org={org} />}
        </div>
      </main>
    </div>
  );
}

function OverviewTab({ stats, recentPayments }: {
  stats: Props["stats"];
  recentPayments: Props["recentPayments"];
}) {
  const successRate = stats.totalPayments > 0
    ? Math.round((stats.settledPayments / stats.totalPayments) * 100)
    : 100;

  return (
    <div className="space-y-8">
      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Monthly Volume", value: `$${(stats.volumeUsd / 1000).toFixed(1)}K`, sub: "USD settled this month", gold: true },
          { label: "Total Payments", value: stats.totalPayments.toString(), sub: "This month" },
          { label: "Success Rate", value: `${successRate}%`, sub: `${stats.settledPayments} settled` },
          { label: "Pending", value: stats.pendingPayments.toString(), sub: "Awaiting settlement" },
        ].map(card => (
          <div key={card.label} className="border border-ink/10 p-6 bg-paper hover:border-gold/40 transition-colors">
            <div className="font-mono text-[9px] tracking-widest uppercase text-mist mb-3">{card.label}</div>
            <div className={cn("font-serif text-3xl mb-1", card.gold ? "text-gold" : "text-ink")}>
              {card.value}
            </div>
            <div className="font-mono text-[10px] text-mist">{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Recent transactions */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="section-tag mb-0">Recent Transactions</div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-v-green-light animate-pulse" />
            <span className="font-mono text-[9px] text-v-green-light">Live</span>
          </div>
        </div>
        <div className="border border-ink/10">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 px-5 py-3 border-b border-ink/8 bg-cream/50">
            {["Counterparties", "Rail", "Amount", "Status", "Time"].map(h => (
              <span key={h} className="font-mono text-[9px] tracking-widest uppercase text-mist">{h}</span>
            ))}
          </div>
          {recentPayments.length === 0 ? (
            <div className="px-5 py-12 text-center font-mono text-xs text-mist">
              No payments yet. Create your first payment via the API.
            </div>
          ) : recentPayments.map(p => (
            <div key={p.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 px-5 py-4 border-b border-ink/5 hover:bg-cream/40 transition-colors">
              <div>
                <div className="font-mono text-xs text-ink truncate">{p.senderName}</div>
                <div className="font-mono text-[10px] text-mist truncate">→ {p.recipientName}</div>
              </div>
              <div className="font-mono text-[10px] text-mist self-center">{railToLabel(p.rail)}</div>
              <div className="font-serif text-sm text-ink self-center">
                {formatCurrency(p.amount, p.currency)}
              </div>
              <div className="self-center">
                <span className={cn("status-pill", STATUS_COLORS[p.status] ?? "status-draft")}>
                  {p.status.replace("_", " ")}
                </span>
              </div>
              <div className="font-mono text-[10px] text-mist self-center">
                {formatRelativeTime(p.createdAt)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Rail usage chart */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { rail: "SWIFT GPI", pct: 68, color: "bg-gold" },
          { rail: "SEPA Instant", pct: 22, color: "bg-v-green-light" },
          { rail: "ACH / FedNow", pct: 10, color: "bg-mist" },
        ].map(r => (
          <div key={r.rail} className="border border-ink/10 p-5">
            <div className="font-mono text-[9px] uppercase tracking-widest text-mist mb-3">{r.rail}</div>
            <div className="font-serif text-2xl text-ink mb-3">{r.pct}%</div>
            <div className="h-1 bg-ink/8">
              <div className={cn("h-full transition-all", r.color)} style={{ width: `${r.pct}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PaymentsTab({ payments, kybApproved }: { payments: Props["recentPayments"]; kybApproved: boolean }) {
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="section-tag mb-0">Payment History</div>
        <button
          onClick={() => setShowCreate(true)}
          disabled={!kybApproved}
          className="btn-primary text-[10px] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + New Payment
        </button>
      </div>

      {!kybApproved && (
        <div className="border border-gold/25 bg-gold/5 px-5 py-4 flex items-start gap-4">
          <span className="text-gold text-lg">⚠</span>
          <div>
            <div className="font-display font-bold text-sm text-ink mb-1">Verification required</div>
            <p className="font-mono text-xs text-mist leading-relaxed">
              Live payments are locked until your verification is approved. <a href="/dashboard/verification" className="text-gold underline">Open verification</a>.
            </p>
          </div>
        </div>
      )}

      {showCreate && (
        <CreatePaymentForm onClose={() => setShowCreate(false)} />
      )}

      <div className="border border-ink/10">
        {payments.map(p => (
          <div key={p.id} className="flex items-center justify-between px-5 py-4 border-b border-ink/5 hover:bg-cream/40 transition-colors">
            <div className="flex-1">
              <div className="font-mono text-xs text-ink">{p.senderName} → {p.recipientName}</div>
              <div className="font-mono text-[10px] text-mist mt-0.5">{p.id} · {railToLabel(p.rail)}</div>
            </div>
            <div className="flex items-center gap-6">
              <div className="font-serif text-base text-ink">{formatCurrency(p.amount, p.currency)}</div>
              <span className={cn("status-pill", STATUS_COLORS[p.status] ?? "status-draft")}>
                {p.status.replace(/_/g, " ")}
              </span>
              <div className="font-mono text-[10px] text-mist w-20 text-right">{formatRelativeTime(p.createdAt)}</div>
            </div>
          </div>
        ))}
        {payments.length === 0 && (
          <div className="px-5 py-12 text-center font-mono text-xs text-mist">No payments yet.</div>
        )}
      </div>
    </div>
  );
}

function CreatePaymentForm({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [rail, setRail] = useState("AUTO");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    // Demo: simulate API call
    await new Promise(r => setTimeout(r, 1200));
    setSuccess(true);
    setLoading(false);
    setTimeout(onClose, 1500);
  }

  return (
    <div className="border border-gold/30 bg-gold/3 p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="font-display font-bold text-sm text-ink">Create Payment</div>
        <button onClick={onClose} className="font-mono text-[11px] text-mist hover:text-ink">✕ Cancel</button>
      </div>
      {success ? (
        <div className="font-mono text-xs text-v-green-light py-4">✓ Payment created and queued for processing.</div>
      ) : (
        <form onSubmit={handleCreate} className="grid grid-cols-3 gap-4">
          <div>
            <label className="label-text">Amount</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="input-field" placeholder="50000" required />
          </div>
          <div>
            <label className="label-text">Currency</label>
            <select value={currency} onChange={e => setCurrency(e.target.value)} className="input-field appearance-none">
              {["USD","EUR","GBP","INR","SGD","AED"].map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label-text">Rail</label>
            <select value={rail} onChange={e => setRail(e.target.value)} className="input-field appearance-none">
              {["AUTO","SWIFT_GPI","SEPA_INSTANT","ACH_SAME_DAY","FEDNOW","UPI"].map(r => (
                <option key={r} value={r}>{railToLabel(r)}</option>
              ))}
            </select>
          </div>
          <div className="col-span-3">
            <button type="submit" disabled={loading} className="btn-primary disabled:opacity-60">
              {loading ? "Processing..." : "Create Payment →"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function ApiTab() {
  const [copied, setCopied] = useState(false);
  const demoKey = "vlt_test_a1b2c3d4e5f6g7h8i9j0k1l2m3n4";

  function copy() {
    navigator.clipboard.writeText(demoKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <div className="section-tag">API Keys</div>
        <p className="font-mono text-xs text-mist leading-relaxed">
          Use these keys to authenticate API requests. Test keys use sandbox rails — no real money moves. Live keys require KYB approval.
        </p>
      </div>

      {/* Test key */}
      <div className="border border-ink/10 p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="font-display font-bold text-sm text-ink">Default Test Key</div>
            <div className="font-mono text-[9px] text-mist mt-0.5">Test Mode · All scopes</div>
          </div>
          <span className="status-pill status-pending">TEST</span>
        </div>
        <div className="flex items-center gap-3">
          <code className="flex-1 font-mono text-xs bg-ink text-gold px-4 py-3 truncate">{demoKey}</code>
          <button onClick={copy} className="btn-ghost text-[10px] whitespace-nowrap">
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
      </div>

      {/* Scopes */}
      <div>
        <div className="section-tag mb-3">Scopes</div>
        <div className="grid grid-cols-2 gap-2">
          {[
            "payments:read", "payments:write",
            "invoices:read", "invoices:write",
            "kyb:write", "fx:read",
            "webhooks:write", "entities:read",
          ].map(scope => (
            <div key={scope} className="flex items-center gap-2 border border-ink/8 px-3 py-2">
              <span className="text-v-green-light text-xs">✓</span>
              <span className="font-mono text-[10px] text-slate">{scope}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Quick start */}
      <div>
        <div className="section-tag mb-3">Quick Start</div>
        <pre className="bg-ink text-paper font-mono text-xs p-5 overflow-auto leading-relaxed">
          <span className="text-mist"># Create a payment</span>{"\n"}
          <span className="text-gold">curl</span> -X POST https://api.vaulte.io/v1/payments \{"\n"}
          {"  "}-H <span className="text-v-green-light">&quot;Authorization: Bearer {demoKey}&quot;</span> \{"\n"}
          {"  "}-H <span className="text-v-green-light">&quot;Content-Type: application/json&quot;</span> \{"\n"}
          {"  "}-d <span className="text-v-green-light">&apos;&#123;"amount":127500,"currency":"USD","rail":"AUTO"&#125;&apos;</span>
        </pre>
      </div>
    </div>
  );
}

function SettingsTab({ user, org }: { user: AuthUser; org: Props["org"] }) {
  return (
    <div className="space-y-8 max-w-xl">
      <div>
        <div className="section-tag">Account Settings</div>
      </div>
      <div className="space-y-4">
        {[
          { label: "Organization", value: user.organizationName },
          { label: "Email", value: user.email },
          { label: "Role", value: user.role },
          { label: "KYB Status", value: org?.kybStatus ?? "N/A" },
          { label: "Risk Tier", value: org?.riskTier ?? "N/A" },
          { label: "Plan", value: org?.planId?.toUpperCase() ?? "STARTER" },
        ].map(item => (
          <div key={item.label} className="flex items-center justify-between border-b border-ink/8 pb-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-mist">{item.label}</span>
            <span className="font-mono text-xs text-ink">{item.value}</span>
          </div>
        ))}
      </div>
      <div>
        <div className="section-tag mb-3">Compliance Documents</div>
        <div className="space-y-2">
          {["AML Policy v3.1", "Terms of Service", "Privacy Policy", "Data Processing Agreement"].map(doc => (
            <div key={doc} className="flex items-center justify-between border border-ink/10 px-4 py-3">
              <span className="font-mono text-xs text-slate">{doc}</span>
              <button className="font-mono text-[9px] text-gold hover:underline">Download PDF</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
