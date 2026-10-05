"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthUser } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  user: AuthUser;
  org: {
    onboardingStep: string; onboardingDone: boolean; kybStatus: string;
    name: string; country: string | null; legalName: string | null;
    registrationNumber: string | null; taxId: string | null; businessType: string | null;
  };
}

const STEPS = [
  { id: "COMPANY_DETAILS", label: "Company Details", num: 1 },
  { id: "ADD_ENTITY",      label: "Add Entity",      num: 2 },
  { id: "FIRST_PAYMENT",   label: "Test Payment",    num: 3 },
  { id: "KYB_SUBMIT",      label: "KYB Verify",      num: 4 },
  { id: "GO_LIVE",          label: "Go Live",         num: 5 },
];

export default function OnboardingClient({ user, org }: Props) {
  const router = useRouter();
  const currentStepIdx = STEPS.findIndex(s => s.id === org.onboardingStep) ?? 0;
  const [step, setStep] = useState(Math.max(0, currentStepIdx));
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<Record<number, boolean>>({});

  async function advance(stepIdx: number) {
    setLoading(true);
    await new Promise(r => setTimeout(r, 600));
    setDone(d => ({ ...d, [stepIdx]: true }));
    if (stepIdx + 1 >= STEPS.length) {
      router.push("/dashboard");
    } else {
      setStep(stepIdx + 1);
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-paper flex">
      {/* Sidebar progress */}
      <aside className="w-[260px] bg-ink p-10 flex flex-col justify-between">
        <div>
          <div className="font-serif text-xl text-paper mb-12">Vaulte</div>
          <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/30 mb-6">Setup Progress</div>
          <div className="space-y-2">
            {STEPS.map((s, i) => {
              const isActive = i === step;
              const isDone = done[i] || i < currentStepIdx;
              return (
                <div key={s.id} className={cn(
                  "flex items-center gap-4 px-3 py-3 transition-colors",
                  isActive ? "bg-white/8" : ""
                )}>
                  <div className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center font-mono text-xs flex-shrink-0 transition-colors",
                    isDone ? "bg-v-green-light text-ink" :
                    isActive ? "bg-gold text-ink" :
                    "border border-white/20 text-white/30"
                  )}>
                    {isDone ? "✓" : s.num}
                  </div>
                  <span className={cn(
                    "font-mono text-[11px] tracking-wide",
                    isActive ? "text-paper" : isDone ? "text-white/50" : "text-white/30"
                  )}>{s.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div className="font-mono text-[9px] text-white/30 mb-2">
            Step {step + 1} of {STEPS.length}
          </div>
          <div className="h-1 bg-white/10">
            <div
              className="h-full bg-gold transition-all duration-500"
              style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            />
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center p-12">
        <div className="w-full max-w-[520px]">
          {step === 0 && <StepCompanyDetails user={user} org={org} onNext={() => advance(0)} loading={loading} />}
          {step === 1 && <StepAddEntity orgId={user.organizationId} onNext={() => advance(1)} loading={loading} />}
          {step === 2 && <StepTestPayment orgId={user.organizationId} onNext={() => advance(2)} loading={loading} />}
          {step === 3 && <StepKYB user={user} org={org} onNext={() => advance(3)} loading={loading} />}
          {step === 4 && <StepGoLive onNext={() => advance(4)} loading={loading} />}
        </div>
      </main>
    </div>
  );
}

function StepCompanyDetails({ user, org, onNext, loading }: {
  user: AuthUser; org: Props["org"]; onNext: () => void; loading: boolean;
}) {
  const [form, setForm] = useState({
    legalName: org.legalName ?? org.name,
    businessType: org.businessType ?? "technology",
    website: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/onboarding/company", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    onNext();
  }

  return (
    <form onSubmit={submit}>
      <div className="section-tag">Step 1 of 5</div>
      <h1 className="font-serif text-4xl text-ink mb-3">Tell us about<br/><em className="text-gold">your business.</em></h1>
      <p className="font-mono text-xs text-mist mb-8 leading-relaxed">
        This helps us configure your account correctly. Takes 2 minutes.
      </p>
      <div className="space-y-4">
        <div>
          <label className="label-text">Legal Company Name</label>
          <input className="input-field" value={form.legalName}
            onChange={e => setForm(f => ({ ...f, legalName: e.target.value }))}
            placeholder="Acme Technologies Pvt. Ltd." required />
        </div>
        <div>
          <label className="label-text">Business Type</label>
          <select className="input-field appearance-none" value={form.businessType}
            onChange={e => setForm(f => ({ ...f, businessType: e.target.value }))}>
            <option value="technology">Technology / SaaS</option>
            <option value="manufacturing">Manufacturing & Export</option>
            <option value="logistics">Logistics & Freight</option>
            <option value="professional_services">Professional Services</option>
            <option value="wholesale">Wholesale / Distribution</option>
            <option value="ecommerce">E-Commerce / Marketplace</option>
          </select>
        </div>
        <div>
          <label className="label-text">Company Website (optional)</label>
          <input className="input-field" value={form.website}
            onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
            placeholder="https://acmecorp.com" type="url" />
        </div>
      </div>
      <button type="submit" disabled={loading} className="btn-primary w-full mt-8 disabled:opacity-60">
        {loading ? "Saving..." : "Continue →"}
      </button>
    </form>
  );
}

function StepAddEntity({ orgId, onNext, loading }: {
  orgId: string; onNext: () => void; loading: boolean;
}) {
  const [form, setForm] = useState({ legalName: "", country: "IN", currency: "INR" });
  const [sandboxCreated, setSandboxCreated] = useState(false);

  async function createSandboxEntity() {
    await fetch("/api/entities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, isSandbox: true }),
    });
    setSandboxCreated(true);
  }

  return (
    <div>
      <div className="section-tag">Step 2 of 5</div>
      <h1 className="font-serif text-4xl text-ink mb-3">Add your first<br/><em className="text-gold">business entity.</em></h1>
      <p className="font-mono text-xs text-mist mb-8 leading-relaxed">
        Entities are the sender/recipient businesses in your payments.
        Add your company as sender, and a test recipient.
      </p>

      {!sandboxCreated ? (
        <div className="space-y-4">
          <div>
            <label className="label-text">Entity Name</label>
            <input className="input-field" value={form.legalName}
              onChange={e => setForm(f => ({ ...f, legalName: e.target.value }))}
              placeholder="Acme Corp Ltd." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label-text">Country</label>
              <select className="input-field appearance-none" value={form.country}
                onChange={e => setForm(f => ({ ...f, country: e.target.value }))}>
                <option value="IN">India</option>
                <option value="US">USA</option>
                <option value="GB">UK</option>
                <option value="SG">Singapore</option>
                <option value="DE">Germany</option>
              </select>
            </div>
            <div>
              <label className="label-text">Primary Currency</label>
              <select className="input-field appearance-none" value={form.currency}
                onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                <option>INR</option><option>USD</option>
                <option>EUR</option><option>GBP</option><option>SGD</option>
              </select>
            </div>
          </div>
          <button onClick={createSandboxEntity} disabled={!form.legalName} className="btn-gold w-full disabled:opacity-40">
            Create Entity →
          </button>
          <p className="font-mono text-[9px] text-mist text-center">
            We&apos;ll also create a sandbox test recipient automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="border border-v-green/25 bg-v-green/5 p-5">
            <div className="font-mono text-[9px] uppercase tracking-widest text-v-green mb-2">✓ Entity Created</div>
            <div className="font-mono text-xs text-ink">{form.legalName}</div>
            <div className="font-mono text-[10px] text-mist mt-1">{form.country} · {form.currency} · Sandbox</div>
          </div>
          <div className="border border-v-green/25 bg-v-green/5 p-5">
            <div className="font-mono text-[9px] uppercase tracking-widest text-v-green mb-2">✓ Test Recipient Created</div>
            <div className="font-mono text-xs text-ink">Vaulte Test Recipient Co.</div>
            <div className="font-mono text-[10px] text-mist mt-1">US · USD · Sandbox</div>
          </div>
          <button onClick={onNext} disabled={loading} className="btn-primary w-full disabled:opacity-60">
            {loading ? "..." : "Continue →"}
          </button>
        </div>
      )}
    </div>
  );
}

function StepTestPayment({ orgId, onNext, loading }: {
  orgId: string; onNext: () => void; loading: boolean;
}) {
  const [sent, setSent] = useState(false);
  const [settling, setSettling] = useState(false);
  const [settled, setSettled] = useState(false);

  async function sendTestPayment() {
    setSent(true);
    setSettling(true);
    await new Promise(r => setTimeout(r, 2000));
    setSettling(false);
    setSettled(true);
  }

  return (
    <div>
      <div className="section-tag">Step 3 of 5</div>
      <h1 className="font-serif text-4xl text-ink mb-3">Send your first<br/><em className="text-gold">test payment.</em></h1>
      <p className="font-mono text-xs text-mist mb-8 leading-relaxed">
        No real money. This is your sandbox. See exactly what a B2B payment looks like end-to-end.
      </p>

      <div className="border border-ink/10 p-6 mb-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-widest text-mist mb-1">Test Payment</div>
            <div className="font-serif text-2xl text-ink">$50,000.00</div>
          </div>
          <span className={cn(
            "status-pill text-[9px]",
            settled ? "status-settled" : settling ? "status-processing" : "status-draft"
          )}>
            {settled ? "SETTLED" : settling ? "PROCESSING" : "READY"}
          </span>
        </div>
        <div className="space-y-2 font-mono text-xs">
          <div className="flex justify-between">
            <span className="text-mist">From</span>
            <span className="text-ink">Your Company (Sandbox)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-mist">To</span>
            <span className="text-ink">Vaulte Test Recipient</span>
          </div>
          <div className="flex justify-between">
            <span className="text-mist">Rail</span>
            <span className="text-ink">SWIFT GPI (Sandbox)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-mist">Fee</span>
            <span className="text-ink">$20.00 (0.04%)</span>
          </div>
        </div>
      </div>

      {settled ? (
        <div className="space-y-4">
          <div className="border border-v-green/25 bg-v-green/5 p-4 text-center">
            <div className="text-v-green-light text-2xl mb-2">✓</div>
            <div className="font-display font-bold text-sm text-ink">Payment Settled in Sandbox</div>
            <div className="font-mono text-[10px] text-mist mt-1">
              Real SWIFT GPI would take ~30 minutes. Sandbox: instant.
            </div>
          </div>
          <button onClick={onNext} className="btn-primary w-full">
            Continue →
          </button>
        </div>
      ) : sent ? (
        <div className="border border-gold/25 bg-gold/5 p-4 flex items-center gap-4">
          <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <div className="font-mono text-xs text-gold">Processing via SWIFT GPI sandbox...</div>
        </div>
      ) : (
        <button onClick={sendTestPayment} className="btn-gold w-full">
          Send Test Payment →
        </button>
      )}
    </div>
  );
}

function StepKYB({ org, onNext, loading }: {
  user: AuthUser; org: Props["org"]; onNext: () => void; loading: boolean;
}) {
  const started = org.kybStatus !== "NOT_STARTED";
  return (
    <div>
      <div className="section-tag">Step 4 of 5</div>
      <h1 className="font-serif text-4xl text-ink mb-3">Verify your<br/><em className="text-gold">identity.</em></h1>
      <p className="font-mono text-xs text-mist mb-8 leading-relaxed">
        Verification is required before live payments. What we ask for depends on your country and what you will use Vaulte for.
        You can save progress and finish later. Sandbox payments work while you wait.
      </p>
      <div className="space-y-4">
        <a href="/dashboard/verification" className="btn-primary w-full block text-center">
          {started ? "Continue verification →" : "Start verification →"}
        </a>
        <button onClick={onNext} disabled={loading} className="btn-ghost w-full disabled:opacity-60">
          {loading ? "..." : "Skip for now: go to dashboard →"}
        </button>
      </div>
    </div>
  );
}

function StepGoLive({ onNext, loading }: { onNext: () => void; loading: boolean }) {
  return (
    <div>
      <div className="section-tag">Step 5 of 5</div>
      <h1 className="font-serif text-4xl text-ink mb-3">
        You&apos;re almost<br/><em className="text-gold">live.</em>
      </h1>
      <p className="font-mono text-xs text-mist mb-8 leading-relaxed">
        Your account is configured. Finish verification from the dashboard to unlock live payments.
        Meanwhile, explore the sandbox.
      </p>

      <div className="space-y-3 mb-8">
        {[
          { title: "Sandbox Active", desc: "Test payments work right now", done: true },
          { title: "API Keys Ready", desc: "Use your test key to integrate", done: true },
          { title: "Verification", desc: "Complete it from the dashboard", done: false },
          { title: "Live Payments", desc: "Unlocked after verification is approved", done: false },
        ].map(item => (
          <div key={item.title} className={cn(
            "flex items-start gap-4 p-4 border",
            item.done ? "border-v-green/20 bg-v-green/4" : "border-ink/10"
          )}>
            <span className={cn("text-lg mt-0.5", item.done ? "text-v-green-light" : "text-mist")}>
              {item.done ? "✓" : "○"}
            </span>
            <div>
              <div className="font-display font-bold text-sm text-ink">{item.title}</div>
              <div className="font-mono text-[10px] text-mist mt-0.5">{item.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <button onClick={onNext} disabled={loading} className="btn-gold w-full disabled:opacity-60">
        {loading ? "..." : "Go to Dashboard →"}
      </button>
    </div>
  );
}
