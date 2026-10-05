"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import AuthShell, { ErrorBox } from "./AuthShell";
import { api } from "@/lib/client-api";

export default function AcceptInviteClient({ token }: { token: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError("");
    const r = await api("/api/team/invites/accept", { body: { token, name, password, accept_terms: terms } });
    setLoading(false);
    if (!r.ok) return setError(r.error?.message ?? "Could not accept invitation");
    router.push("/dashboard");
    router.refresh();
  }

  if (!token) return <AuthShell tag="Invitation" title="Link incomplete."><p className="font-mono text-xs text-mist">Open the link from your invitation email.</p></AuthShell>;
  return (
    <AuthShell tag="Invitation" title="Join your team." subtitle="Choose a password to finish creating your account.">
      <form onSubmit={submit} className="space-y-4">
        <div><label className="label-text">Your full name</label><input className="input-field" value={name} onChange={e => setName(e.target.value)} required /></div>
        <div><label className="label-text">Password</label><input type="password" className="input-field" value={password} onChange={e => setPassword(e.target.value)} required minLength={10} autoComplete="new-password" /></div>
        <label className="flex gap-3 font-mono text-[10px] text-slate leading-relaxed items-start"><input type="checkbox" checked={terms} onChange={e => setTerms(e.target.checked)} required className="mt-0.5" /><span>I agree to the Terms, Privacy Policy and AML Policy.</span></label>
        <ErrorBox message={error} />
        <button type="submit" disabled={loading || !terms} className="btn-primary w-full disabled:opacity-60">{loading ? "Creating..." : "Join →"}</button>
      </form>
    </AuthShell>
  );
}
