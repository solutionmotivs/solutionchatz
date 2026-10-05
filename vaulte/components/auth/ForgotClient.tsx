"use client";
import { useState } from "react";
import Link from "next/link";
import AuthShell, { CodeInput, ErrorBox } from "./AuthShell";
import { api } from "@/lib/client-api";

export default function ForgotClient() {
  const [step, setStep] = useState<"email" | "reset" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError("");
    if (step === "email") {
      const r = await api("/api/auth/password/forgot", { body: { email } });
      if (r.ok) { setInfo(r.data.dev_code ? `Dev mode: your code is ${r.data.dev_code}` : ""); setStep("reset"); } else setError(r.error?.message ?? "Could not send code");
    } else {
      const r = await api("/api/auth/password/reset", { body: { email, code, new_password: pw } });
      if (r.ok) setStep("done"); else setError(r.error?.message ?? "Could not reset password");
    }
    setLoading(false);
  }

  if (step === "done") {
    return (
      <AuthShell tag="Password updated" title="All set." subtitle="You were signed out of every device.">
        <Link href="/login" className="btn-primary block text-center">Sign in →</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell tag="Reset password" title={step === "email" ? "Forgot password?" : "Choose a new password."} subtitle={step === "email" ? "We will email you a 6-digit code." : <>Code sent to <span className="text-ink">{email}</span> if an account exists.</>}>
      <form onSubmit={submit} className="space-y-5">
        {step === "email" ? (
          <div>
            <label className="label-text">Email</label>
            <input type="email" className="input-field" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          </div>
        ) : (
          <>
            <CodeInput value={code} onChange={setCode} />
            {info && <div className="font-mono text-[10px] text-gold">{info}</div>}
            <div>
              <label className="label-text">New password</label>
              <input type="password" className="input-field" value={pw} onChange={e => setPw(e.target.value)} required minLength={10} autoComplete="new-password" />
            </div>
          </>
        )}
        <ErrorBox message={error} />
        <button type="submit" disabled={loading || (step === "reset" && code.length !== 6)} className="btn-primary w-full disabled:opacity-60">{loading ? "Working..." : step === "email" ? "Send code →" : "Update password →"}</button>
        <Link href="/login" className="block font-mono text-[10px] text-mist hover:text-ink">← Back to sign in</Link>
      </form>
    </AuthShell>
  );
}
