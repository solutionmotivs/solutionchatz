"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client-api";
import { ErrorBox } from "@/components/auth/AuthShell";

const VOLUMES: Array<[string, string]> = [["", "Monthly volume (optional)"], ["<10k", "Under USD 10,000"], ["10k-100k", "USD 10,000 to 100,000"], ["100k-1m", "USD 100,000 to 1 million"], [">1m", "Over USD 1 million"]];

export default function PilotForm() {
  const [f, setF] = useState({ name: "", email: "", company: "", country: "", role: "", corridor: "", volume_band: "", use_case: "", website: "", consent: false });
  const [err, setErr] = useState(""); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  const set = (k: string, v: string | boolean) => setF({ ...f, [k]: v });
  async function submit() {
    setErr(""); setBusy(true);
    const body: Record<string, unknown> = { ...f, country: f.country.toUpperCase(), source: "pilot-page" };
    for (const k of ["role", "corridor", "volume_band", "use_case"]) if (!body[k]) delete body[k];
    const r = await api("/api/leads", { body });
    setBusy(false);
    if (!r.ok) return setErr(r.error?.message ?? "Could not send");
    setDone(true);
  }
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center p-6">
      <div className="w-full max-w-[560px]">
        <Link href="/" className="font-serif text-xl text-ink">Vaulte</Link>
        <div className="section-tag mt-8">Pilot</div>
        <h1 className="font-serif text-4xl text-ink mb-3">Join the pilot</h1>
        <p className="font-mono text-xs text-mist leading-relaxed mb-6">Try quotes, invoices, verification and certificates in <strong>test mode</strong>, with simulated partners. No real money moves and Vaulte does not hold funds. Live payments go through licensed partners only, country by country after legal review; we will tell you plainly when a corridor is ready.</p>
        {done ? (
          <div className="border border-[#2D6A4F]/40 bg-[#2D6A4F]/5 px-5 py-4 text-[13px]">Thank you. We have your details and will write to you. You can also <Link href="/register" className="text-gold underline">open a free test-mode account</Link> now.</div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            <div><label className="label-text">Your name *</label><input className="input-field" value={f.name} onChange={e => set("name", e.target.value)} /></div>
            <div><label className="label-text">Work email *</label><input className="input-field" type="email" value={f.email} onChange={e => set("email", e.target.value)} /></div>
            <div><label className="label-text">Company *</label><input className="input-field" value={f.company} onChange={e => set("company", e.target.value)} /></div>
            <div><label className="label-text">Country (2 letters, e.g. IN) *</label><input className="input-field" maxLength={2} value={f.country} onChange={e => set("country", e.target.value.toUpperCase())} /></div>
            <div><label className="label-text">Your role</label><input className="input-field" value={f.role} onChange={e => set("role", e.target.value)} /></div>
            <div><label className="label-text">Corridor you need (e.g. US to India)</label><input className="input-field" value={f.corridor} onChange={e => set("corridor", e.target.value)} /></div>
            <div className="sm:col-span-2"><select className="input-field" value={f.volume_band} onChange={e => set("volume_band", e.target.value)}>{VOLUMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div className="sm:col-span-2"><label className="label-text">What do you want to do?</label><textarea className="input-field" rows={3} value={f.use_case} onChange={e => set("use_case", e.target.value)} /></div>
            <input className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={e => set("website", e.target.value)} name="website" />
            <label className="sm:col-span-2 flex gap-3 text-[11px] text-slate leading-relaxed"><input type="checkbox" checked={f.consent} onChange={e => set("consent", e.target.checked)} className="mt-1" />I agree that Vaulte may contact me about the pilot. I can ask for my details to be corrected or deleted (see the <Link href="/legal/privacy" className="text-gold underline">privacy notice</Link>).</label>
            <div className="sm:col-span-2"><ErrorBox message={err} /></div>
            <div className="sm:col-span-2"><button className="btn-primary disabled:opacity-40" disabled={busy || !f.consent || f.name.length < 2 || !f.email || f.company.length < 2 || f.country.length !== 2} onClick={submit}>Send</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
