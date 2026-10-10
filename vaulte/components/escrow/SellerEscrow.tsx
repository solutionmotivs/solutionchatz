"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { ErrorBox } from "@/components/auth/AuthShell";
import { Chip, Section, Shell } from "@/components/verification/shared";

interface Entity { id: string; legalName: string; country: string; currency: string; entityType: string }
interface Ms { title: string; amount: string; pay_timing: "UPFRONT" | "ON_APPROVAL" }
const major = (n: number, c: string) => (n / (["JPY", "KRW"].includes(c) ? 1 : 100)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TONE: Record<string, string> = { RELEASED: "APPROVED", COMPLETED: "APPROVED", FUNDED: "IN_REVIEW", ACTIVE: "IN_REVIEW", SUBMITTED: "NEEDS_INFO", APPROVED: "IN_REVIEW", DISPUTED: "REJECTED", REFUNDED: "REJECTED", CANCELLED: "REJECTED", PENDING: "DRAFT", DRAFT: "DRAFT", AWAITING_BUYER: "NEEDS_INFO" };

export default function SellerEscrow({ role, entities, live }: { role: string; entities: Entity[]; live: boolean }) {
  const canWrite = ["OWNER", "ADMIN", "FINANCE"].includes(role);
  const [deals, setDeals] = useState<any[]>([]);
  const [open, setOpen] = useState<any>(null);
  const [err, setErr] = useState(""); const [msg, setMsg] = useState("");
  const [f, setF] = useState({ title: "", terms: "", mode: "PAY_ON_APPROVAL", currency: entities[0]?.currency ?? "USD", seller: entities[0]?.id ?? "", purpose: "", buyer_name: "", buyer_email: "", buyer_country: "US", window: "7" });
  const [ms, setMs] = useState<Ms[]>([{ title: "", amount: "", pay_timing: "ON_APPROVAL" }]);

  const load = useCallback(async () => { const r = await api("/api/escrow/deals"); if (r.ok) setDeals(r.data.data); }, []);
  useEffect(() => { load(); }, [load]);
  async function show(id: string) { const r = await api(`/api/escrow/deals/${id}`); if (r.ok) setOpen(r.data); }

  async function create() {
    setErr(""); setMsg("");
    const dec = ["JPY", "KRW"].includes(f.currency) ? 1 : 100;
    const body: any = { title: f.title, terms: f.terms, mode: f.mode, currency: f.currency, approval_window_days: Number(f.window), buyer_name: f.buyer_name, buyer_email: f.buyer_email, buyer_country: f.buyer_country, ...(f.seller ? { seller_entity_id: f.seller } : {}), ...(f.purpose ? { purpose_code: f.purpose } : {}), milestones: ms.filter(m => m.title).map(m => ({ title: m.title, amount: Math.round(Number(m.amount || 0) * dec), ...(f.mode === "PAY_ON_APPROVAL" ? { pay_timing: m.pay_timing } : {}) })) };
    const r = await api("/api/escrow/deals", { body });
    if (!r.ok) return setErr(r.error?.message ?? "Could not create");
    setMsg("Deal created as a draft. Review it below, then send it to the buyer."); setMs([{ title: "", amount: "", pay_timing: "ON_APPROVAL" }]); load(); show(r.data.id);
  }
  async function step(path: string, body: unknown = {}) { setErr(""); const r = await api(path, { body }); if (!r.ok) setErr(r.error?.message ?? "Failed"); else { setMsg(r.data.link ? `Sent. Buyer link: ${r.data.link}` : "Done."); load(); if (open) show(open.id); } }

  return (
    <Shell title="Deals and escrow" right={<a className="text-mist hover:text-ink" href="/dashboard">Dashboard</a>}>
      <p className="text-[12px] text-slate leading-relaxed max-w-2xl mb-4">Agree milestones with a buyer. Vaulte never holds the money. <strong>Pay on approval</strong> is milestone billing: no one holds funds, and each milestone is invoiced when the buyer approves it. <strong>Partner escrow</strong> has a licensed escrow agent hold the buyer's money until release{live ? "; no agent is configured on this deployment yet, so it is unavailable for live accounts" : " (test mode uses a sandbox agent)"}.</p>
      {err && <ErrorBox message={err} />}{msg && <div className="border border-[#2D6A4F]/40 bg-[#2D6A4F]/5 px-4 py-3 text-[12px] mb-6 break-all">{msg}</div>}
      {canWrite && (
        <Section title="New deal">
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2"><label className="label-text">Title</label><input className="input-field" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></div>
            <div><label className="label-text">How the money works</label><select className="input-field" value={f.mode} onChange={e => setF({ ...f, mode: e.target.value })}><option value="PAY_ON_APPROVAL">Pay on approval (no one holds funds)</option><option value="PARTNER_ESCROW">Partner escrow (licensed agent holds funds)</option></select></div>
            {entities.length > 1 && <div><label className="label-text">Get paid as</label><select className="input-field" value={f.seller} onChange={e => setF({ ...f, seller: e.target.value })}>{entities.map(e => <option key={e.id} value={e.id}>{e.legalName} ({e.country})</option>)}</select></div>}
            <div><label className="label-text">Currency</label><input className="input-field" maxLength={3} value={f.currency} onChange={e => setF({ ...f, currency: e.target.value.toUpperCase() })} /></div>
            <div><label className="label-text">Purpose code (Indian business)</label><input className="input-field" placeholder="P0802" value={f.purpose} onChange={e => setF({ ...f, purpose: e.target.value.toUpperCase() })} /></div>
            <div><label className="label-text">Buyer name</label><input className="input-field" value={f.buyer_name} onChange={e => setF({ ...f, buyer_name: e.target.value })} /></div>
            <div><label className="label-text">Buyer email</label><input className="input-field" type="email" value={f.buyer_email} onChange={e => setF({ ...f, buyer_email: e.target.value })} /></div>
            <div><label className="label-text">Buyer country</label><input className="input-field" maxLength={2} value={f.buyer_country} onChange={e => setF({ ...f, buyer_country: e.target.value.toUpperCase() })} /></div>
            <div><label className="label-text">Silence counts as approval after (days)</label><input className="input-field" type="number" min={3} max={30} value={f.window} onChange={e => setF({ ...f, window: e.target.value })} /></div>
          </div>
          <div className="mt-4"><label className="label-text">Terms the buyer will read and accept</label><textarea className="input-field" rows={4} value={f.terms} onChange={e => setF({ ...f, terms: e.target.value })} /></div>
          <div className="mt-4">
            <div className="grid grid-cols-[1fr_130px_160px] gap-2 text-[9px] uppercase tracking-widest text-mist mb-1"><span>Milestone</span><span>Amount</span><span>{f.mode === "PAY_ON_APPROVAL" ? "When paid" : ""}</span></div>
            {ms.map((m, i) => (
              <div key={i} className="grid grid-cols-[1fr_130px_160px] gap-2 mb-2">
                <input className="input-field" aria-label={`Milestone ${i + 1} title`} value={m.title} onChange={e => setMs(ms.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
                <input className="input-field" aria-label={`Milestone ${i + 1} amount`} type="number" min="0" step="0.01" value={m.amount} onChange={e => setMs(ms.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
                {f.mode === "PAY_ON_APPROVAL" ? <select className="input-field" aria-label={`Milestone ${i + 1} timing`} value={m.pay_timing} onChange={e => setMs(ms.map((x, j) => j === i ? { ...x, pay_timing: e.target.value as Ms["pay_timing"] } : x))}><option value="ON_APPROVAL">On approval</option><option value="UPFRONT">Upfront</option></select> : <span />}
              </div>))}
            <button className="text-gold text-[11px] hover:underline" onClick={() => setMs([...ms, { title: "", amount: "", pay_timing: "ON_APPROVAL" }])}>+ Add milestone</button>
          </div>
          <button className="btn-primary mt-5 disabled:opacity-40" disabled={!f.title || f.terms.length < 20 || !f.buyer_name || !f.buyer_email || !ms.some(m => m.title && Number(m.amount) > 0)} onClick={create}>Create deal</button>
        </Section>
      )}
      <Section title="Your deals">
        {deals.length === 0 ? <p className="text-[11px] text-mist">No deals yet.</p> : deals.map(d => (
          <div key={d.id} className="flex flex-wrap items-center gap-3 border-t border-ink/10 first:border-0 py-3 text-[12px]">
            <strong>{d.title}</strong><span className="text-mist">{d.buyer.name}</span><span>{d.currency} {major(d.total, d.currency)}</span><Chip status={TONE[d.status] ?? "DRAFT"} label={d.status.replace("_", " ")} /><span className="text-mist">{d.mode === "PARTNER_ESCROW" ? "escrow" : "pay on approval"}</span>
            <button className="text-gold hover:underline" onClick={() => show(d.id)}>Open</button>
          </div>))}
      </Section>
      {open && (
        <Section title={open.title} hint={open.disclosure}>
          <div className="flex flex-wrap gap-3 mb-4 text-[12px]"><Chip status={TONE[open.status] ?? "DRAFT"} label={open.status.replace("_", " ")} />
            {canWrite && ["DRAFT", "AWAITING_BUYER"].includes(open.status) && <button className="btn-gold !py-2 !px-4" onClick={() => step(`/api/escrow/deals/${open.id}/send`)}>{open.status === "DRAFT" ? "Send to buyer" : "Resend to buyer"}</button>}
            {canWrite && ["DRAFT", "AWAITING_BUYER", "ACTIVE"].includes(open.status) && <button className="text-[#9B2C2C] text-[11px] uppercase tracking-widest" onClick={() => step(`/api/escrow/deals/${open.id}/cancel`)}>Cancel deal</button>}
          </div>
          {open.milestones.map((m: any) => (
            <div key={m.id} className="flex flex-wrap items-center gap-3 border-t border-ink/10 first:border-0 py-2 text-[12px]">
              <strong>{m.seq}. {m.title}</strong><span>{open.currency} {major(m.amount, open.currency)}</span><Chip status={TONE[m.status] ?? "DRAFT"} label={m.status} />
              {canWrite && open.status === "ACTIVE" && (open.mode === "PARTNER_ESCROW" || m.pay_timing === "UPFRONT" ? m.status === "FUNDED" : m.status === "PENDING") && <button className="text-gold hover:underline" onClick={() => { const note = window.prompt("Delivery note for the buyer (optional)") ?? ""; step(`/api/escrow/deals/${open.id}/milestones/${m.id}/submit`, { note }); }}>Submit delivery</button>}
              {canWrite && ["SUBMITTED", "FUNDED"].includes(m.status) && <button className="text-[#9B2C2C] text-[10px] uppercase tracking-widest" onClick={() => { const reason = window.prompt("Describe the problem (at least 10 characters)"); if (reason) step(`/api/escrow/deals/${open.id}/milestones/${m.id}/dispute`, { reason }); }}>Dispute</button>}
              {m.dispute && <span className="text-[#9A4B12] w-full">Dispute: {m.dispute.reason}{m.dispute.resolution ? ` (resolved: ${m.dispute.resolution})` : ""}</span>}
            </div>))}
          {open.timeline && <div className="mt-4 text-[11px] text-mist"><div className="uppercase tracking-widest text-[9px] mb-1">Timeline</div>{open.timeline.map((e: any, i: number) => <div key={i}>{new Date(e.at).toLocaleString()} · {e.actor.toLowerCase()} · {e.type.replace(/_/g, " ").toLowerCase()}{e.note ? ` — ${e.note}` : ""}</div>)}</div>}
        </Section>
      )}
    </Shell>
  );
}
