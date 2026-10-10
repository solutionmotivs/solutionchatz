"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AuthShell, { CodeInput, ErrorBox } from "./AuthShell";
import { api } from "@/lib/client-api";

type Mode = "password" | "otp";
type Step = "credentials" | "otp-code" | "verify-email" | "totp";

export default function LoginClient() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totp, setTotp] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [mfaToken, setMfaToken] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const done = () => { router.push("/dashboard"); router.refresh(); };
  const handle = (r: Awaited<ReturnType<typeof api<any>>>) => {
    if (r.ok && r.data.status === "totp_required") { setMfaToken(r.data.mfa_token); setStep("totp"); return; }
    if (r.ok) return done();
    if (r.error?.code === "EMAIL_NOT_VERIFIED") { setInfo((r.error as any).dev_code ? `Dev mode: your code is ${(r.error as any).dev_code}` : "We sent you a code."); setStep("verify-email"); return; }
    setError(r.error?.message ?? "Sign-in failed");
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError("");
    if (step === "credentials" && mode === "password") handle(await api("/api/auth/login", { body: { email, password } }));
    else if (step === "credentials" && mode === "otp") {
      const r = await api("/api/auth/otp/request", { body: { email } });
      if (r.ok) { setInfo(r.data.dev_code ? `Dev mode: your code is ${r.data.dev_code}` : "If an account exists, we sent a 6-digit code."); setStep("otp-code"); } else setError(r.error?.message ?? "Could not send code");
    }
    else if (step === "otp-code") handle(await api("/api/auth/otp/verify", { body: { email, code } }));
    else if (step === "verify-email") {
      const r = await api("/api/auth/verify-email", { body: { email, code } });
      if (r.ok) router.push("/onboarding"); else setError(r.error?.message ?? "Verification failed");
    }
    else if (step === "totp") handle(await api("/api/auth/login/totp", { body: useRecovery ? { mfa_token: mfaToken, recovery_code: totp } : { mfa_token: mfaToken, code: totp } }));
    setLoading(false);
  }

  const title = step === "totp" ? "Two-factor check." : step === "otp-code" || step === "verify-email" ? "Enter your code." : "Welcome back.";
  const tag = step === "totp" ? "Authenticator" : "Secure sign in";

  return (
    <AuthShell tag={tag} title={title} subtitle={step === "credentials" ? <>New here? <Link href="/register" className="text-gold hover:underline">Create an account</Link></> : undefined}>
      <form onSubmit={submit} className="space-y-5">
        {step === "credentials" && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {[["password", "Password"], ["otp", "Email code"]].map(([v, l]) => (
                <button key={v} type="button" onClick={() => { setMode(v as Mode); setError(""); }} className={`px-3 py-2 font-mono text-[11px] border ${mode === v ? "border-ink bg-ink text-paper" : "border-ink/20 text-slate hover:border-ink/50"}`}>{l}</button>
              ))}
            </div>
            <div>
              <label className="label-text">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input-field" required autoFocus autoComplete="email" />
            </div>
            {mode === "password" && (
              <div>
                <label className="label-text">Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="input-field" required autoComplete="current-password" />
                <div className="text-right mt-2"><Link href="/forgot-password" className="font-mono text-[10px] text-mist hover:text-ink">Forgot password?</Link></div>
              </div>
            )}
          </>
        )}
        {(step === "otp-code" || step === "verify-email") && (
          <>
            <p className="font-mono text-xs text-mist">Code sent to <span className="text-ink">{email}</span>.</p>
            <CodeInput value={code} onChange={setCode} />
            {info && <div className="font-mono text-[10px] text-gold">{info}</div>}
          </>
        )}
        {step === "totp" && (
          <>
            <p className="font-mono text-xs text-mist">{useRecovery ? "Enter one of your recovery codes." : "Enter the 6-digit code from your authenticator app."}</p>
            {useRecovery ? (
              <input className="input-field" value={totp} onChange={e => setTotp(e.target.value)} placeholder="xxxxx-xxxxx" autoFocus />
            ) : (
              <CodeInput value={totp} onChange={setTotp} />
            )}
            <button type="button" className="font-mono text-[10px] text-mist hover:text-ink" onClick={() => { setUseRecovery(!useRecovery); setTotp(""); }}>{useRecovery ? "Use authenticator app instead" : "Use a recovery code"}</button>
          </>
        )}
        <ErrorBox message={error} />
        <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-60">
          {loading ? "Working..." : step === "credentials" ? (mode === "otp" ? "Email me a code →" : "Sign in →") : "Continue →"}
        </button>
        {step !== "credentials" && (
          <button type="button" className="font-mono text-[10px] text-mist hover:text-ink" onClick={() => { setStep("credentials"); setCode(""); setTotp(""); setError(""); }}>← Start over</button>
        )}
      </form>
      <p className="mt-8 font-mono text-[9px] text-mist leading-relaxed">By signing in you agree to the Terms and AML Policy.</p>
    </AuthShell>
  );
}
