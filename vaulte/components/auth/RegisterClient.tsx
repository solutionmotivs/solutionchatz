"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AuthShell, { CodeInput, ErrorBox } from "./AuthShell";
import { api } from "@/lib/client-api";
import { COUNTRIES } from "@/lib/countries";

type Step = "details" | "code" | "done";

export default function RegisterClient() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("details");
  const [form, setForm] = useState({ account_type: "BUSINESS", name: "", email: "", password: "", company_name: "", country: "IN", accept_terms: false, marketing_opt_in: false });
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const set = (k: string, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  async function submitDetails(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError("");
    const body = { ...form, company_name: form.account_type === "BUSINESS" ? form.company_name : undefined };
    const r = await api("/api/auth/register", { body });
    setLoading(false);
    if (!r.ok) return setError(r.error?.message ?? "Registration failed");
    setInfo(r.data.dev_code ? `Dev mode: your code is ${r.data.dev_code}` : "");
    setCooldown(30);
    setStep("code");
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError("");
    const r = await api("/api/auth/verify-email", { body: { email: form.email, code } });
    setLoading(false);
    if (!r.ok) return setError(r.error?.message ?? "Verification failed");
    setApiKey(r.data.test_api_key ?? "");
    setStep("done");
    if (!r.data.test_api_key) router.push("/onboarding");
  }

  async function resend() {
    setError(""); setInfo("");
    const r = await api("/api/auth/resend-otp", { body: { email: form.email } });
    if (!r.ok) return setError(r.error?.message ?? "Could not resend");
    setInfo(r.data.dev_code ? `Dev mode: your code is ${r.data.dev_code}` : "A new code was sent if one was due.");
    setCooldown(30);
  }

  if (step === "done") {
    return (
      <AuthShell tag="Account ready" title="You're in." subtitle="Your email is verified and your sandbox is ready.">
        <div className="border border-v-green/25 bg-v-green/5 p-5 mb-6">
          <div className="font-mono text-[9px] uppercase tracking-widest text-v-green mb-3">Your sandbox API key (shown once)</div>
          <code className="font-mono text-xs text-ink break-all block">{apiKey}</code>
          <button type="button" className="btn-ghost mt-4 text-[10px]" onClick={() => { navigator.clipboard?.writeText(apiKey); setCopied(true); }}>{copied ? "Copied" : "Copy key"}</button>
          <p className="font-mono text-[9px] text-mist mt-3 leading-relaxed">We never email API keys. You can create more in Dashboard → Profile → API keys.</p>
        </div>
        <button className="btn-primary w-full" onClick={() => router.push("/onboarding")}>Continue to setup →</button>
      </AuthShell>
    );
  }

  if (step === "code") {
    return (
      <AuthShell tag="Verify your email" title="Enter your code." subtitle={<>We sent a 6-digit code to <span className="text-ink">{form.email}</span>. It expires in 10 minutes.</>}>
        <form onSubmit={submitCode} className="space-y-5">
          <CodeInput value={code} onChange={setCode} />
          {info && <div className="font-mono text-[10px] text-gold">{info}</div>}
          <ErrorBox message={error} />
          <button type="submit" disabled={loading || code.length !== 6} className="btn-primary w-full disabled:opacity-60">{loading ? "Verifying..." : "Verify and continue →"}</button>
          <div className="flex justify-between font-mono text-[10px] text-mist">
            <button type="button" onClick={() => setStep("details")} className="hover:text-ink">← Change details</button>
            <button type="button" disabled={cooldown > 0} onClick={resend} className="hover:text-ink disabled:opacity-50">{cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}</button>
          </div>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell tag="Create account" title="Get started." subtitle={<>Already have an account? <Link href="/login" className="text-gold hover:underline">Sign in</Link></>}>
      <form onSubmit={submitDetails} className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          {[["BUSINESS", "Business"], ["INDIVIDUAL", "Individual"]].map(([v, l]) => (
            <button key={v} type="button" onClick={() => set("account_type", v)} className={`px-3 py-3 font-mono text-[11px] border ${form.account_type === v ? "border-ink bg-ink text-paper" : "border-ink/20 text-slate hover:border-ink/50"}`}>{l}</button>
          ))}
        </div>
        <div>
          <label className="label-text">Your full name</label>
          <input className="input-field" value={form.name} onChange={e => set("name", e.target.value)} required autoComplete="name" />
        </div>
        <div>
          <label className="label-text">Email</label>
          <input type="email" className="input-field" value={form.email} onChange={e => set("email", e.target.value)} required autoComplete="email" />
        </div>
        <div>
          <label className="label-text">Password</label>
          <input type="password" className="input-field" value={form.password} onChange={e => set("password", e.target.value)} required minLength={10} autoComplete="new-password" placeholder="At least 10 characters" />
          <p className="font-mono text-[9px] text-mist mt-1">A long passphrase works best. Avoid your name and common passwords.</p>
        </div>
        {form.account_type === "BUSINESS" && (
          <div>
            <label className="label-text">Company legal name</label>
            <input className="input-field" value={form.company_name} onChange={e => set("company_name", e.target.value)} required autoComplete="organization" />
          </div>
        )}
        <div>
          <label className="label-text">{form.account_type === "BUSINESS" ? "Country of incorporation" : "Country of residence"}</label>
          <select className="input-field appearance-none" value={form.country} onChange={e => set("country", e.target.value)}>
            {COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
          </select>
        </div>
        <label className="flex gap-3 font-mono text-[10px] text-slate leading-relaxed items-start">
          <input type="checkbox" checked={form.accept_terms} onChange={e => set("accept_terms", e.target.checked)} className="mt-0.5" required />
          <span>I agree to the <Link href="/legal/terms" className="text-gold hover:underline">Terms</Link>, <Link href="/legal/privacy" className="text-gold hover:underline">Privacy Policy</Link> and <Link href="/legal/aml" className="text-gold hover:underline">AML Policy</Link>, and I will complete identity verification before live payments.</span>
        </label>
        <label className="flex gap-3 font-mono text-[10px] text-mist leading-relaxed items-start">
          <input type="checkbox" checked={form.marketing_opt_in} onChange={e => set("marketing_opt_in", e.target.checked)} className="mt-0.5" />
          <span>Send me product updates (optional).</span>
        </label>
        <ErrorBox message={error} />
        <button type="submit" disabled={loading || !form.accept_terms} className="btn-primary w-full disabled:opacity-60">{loading ? "Creating account..." : "Create account →"}</button>
      </form>
    </AuthShell>
  );
}
