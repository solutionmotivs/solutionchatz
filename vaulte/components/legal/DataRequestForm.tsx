"use client";
import { useState } from "react";
import { api } from "@/lib/client-api";

const TYPES: Array<[string, string]> = [
  ["ACCESS", "Get a copy of my data"], ["CORRECTION", "Correct or update my data"], ["ERASURE", "Delete my data"], ["WITHDRAW_CONSENT", "Withdraw my consent"],
  ["PORTABILITY", "Receive my data in a portable format"], ["OBJECTION", "Object to how my data is used"], ["RESTRICTION", "Restrict how my data is used"],
  ["NOMINATE", "Nominate someone to act for me (India)"], ["APPEAL", "Appeal an earlier decision (US)"], ["OTHER", "Something else"],
];
const REGIONS: Array<[string, string]> = [["IN", "India"], ["US", "United States"], ["AE", "United Arab Emirates"], ["SG", "Singapore"], ["EU", "European Union"], ["UK", "United Kingdom"], ["OTHER", "Another country"]];

export default function DataRequestForm() {
  const [f, setF] = useState({ name: "", email: "", region: "IN", type: "ACCESS", details: "", website: "" });
  const [err, setErr] = useState(""); const [ref, setRef] = useState(""); const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  async function submit() {
    setErr(""); setBusy(true);
    const body: Record<string, unknown> = { ...f }; if (!f.details) delete body.details;
    const r = await api("/api/privacy-requests", { body });
    setBusy(false);
    if (!r.ok) return setErr(r.error?.message ?? "Could not send your request");
    setRef(r.data?.reference ?? "");
  }
  if (ref) return <div role="status" className="border border-[#2D6A4F]/40 bg-[#2D6A4F]/5 px-5 py-4 text-[13px]">Your request is recorded. Reference: <strong>{ref}</strong>. We emailed you; we will confirm your identity there before releasing or changing anything.</div>;
  const field = "w-full border border-ink/20 bg-white px-3 py-2 text-[12px]";
  return (
    <form onSubmit={e => { e.preventDefault(); submit(); }} className="space-y-3 not-prose">
      <label className="block text-[11px]">Your name<input className={field} value={f.name} onChange={e => set("name", e.target.value)} required minLength={2} maxLength={120} autoComplete="name" /></label>
      <label className="block text-[11px]">Email on your Vaulte account (or the email you used with us)<input className={field} type="email" value={f.email} onChange={e => set("email", e.target.value)} required autoComplete="email" /></label>
      <label className="block text-[11px]">Where you live<select className={field} value={f.region} onChange={e => set("region", e.target.value)}>{REGIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="block text-[11px]">What you want<select className={field} value={f.type} onChange={e => set("type", e.target.value)}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="block text-[11px]">Details (optional; do not include passwords or full ID numbers)<textarea className={field} rows={4} maxLength={2000} value={f.details} onChange={e => set("details", e.target.value)} /></label>
      <input aria-hidden tabIndex={-1} autoComplete="off" className="hidden" value={f.website} onChange={e => set("website", e.target.value)} />
      {err && <div role="alert" className="text-[12px] text-[#9A4B12]">{err}</div>}
      <button type="submit" disabled={busy} className="btn-primary disabled:opacity-40">{busy ? "Sending…" : "Send request"}</button>
    </form>
  );
}
