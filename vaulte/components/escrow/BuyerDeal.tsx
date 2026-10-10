"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { Chip } from "@/components/verification/shared";

const major = (n: number, c: string) => (n / (["JPY", "KRW"].includes(c) ? 1 : 100)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TONE: Record<string, string> = { RELEASED: "APPROVED", FUNDED: "IN_REVIEW", SUBMITTED: "NEEDS_INFO", APPROVED: "IN_REVIEW", DISPUTED: "REJECTED", REFUNDED: "REJECTED", CANCELLED: "REJECTED", PENDING: "DRAFT" };

export default function BuyerDeal({ token }: { token: string }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  const [fund, setFund] = useState<Record<string, any>>({});
  const [dispute, setDispute] = useState<{ id: string; reason: string } | null>(null);
  const load = useCallback(async () => { const r = await api(`/api/escrow/public/${token}`); if (r.ok) setD(r.data); else setErr(r.error?.message ?? "This link is not valid."); }, [token]);
  useEffect(() => { load(); }, [load]);

  async function act(path: string, body?: unknown) { setErr(""); const r = await api(`/api/escrow/public/${token}/${path}`, { body: body ?? {} }); if (!r.ok) setErr(r.error?.message ?? "Failed"); else load(); }
  async function showFunding(id: string) { const r = await api(`/api/escrow/public/${token}/milestones/${id}/funding`); if (r.ok) setFund({ ...fund, [id]: r.data }); else setErr(r.error?.message ?? "Could not load funding details"); }

  if (!d) return <Frame>{err ? <p className="text-[#9B2C2C] text-sm">{err}</p> : <p className="text-mist text-sm">Loading…</p>}</Frame>;
  const open = d.status === "AWAITING_BUYER";
  const reasonFor = (id: string) => (dispute && dispute.id === id ? dispute.reason : null);
  return (
    <Frame>
      <div className="text-[10px] uppercase tracking-widest text-mist mb-2">Deal from {d.seller?.name} ({d.seller?.country})</div>
      <h1 className="font-serif text-3xl text-ink mb-1">{d.title}</h1>
      <div className="flex gap-3 items-center mb-6"><Chip status={d.status === "COMPLETED" ? "APPROVED" : d.status === "CANCELLED" ? "REJECTED" : d.status === "ACTIVE" ? "IN_REVIEW" : "DRAFT"} label={d.status.replace("_", " ")} /><span className="text-[12px] text-slate">Total {d.currency} {major(d.total, d.currency)}</span></div>
      {d.description && <p className="text-[12px] text-slate mb-4">{d.description}</p>}
      <div className="border border-gold/50 bg-gold/5 px-4 py-3 text-[12px] leading-relaxed mb-6" role="note"><strong>How the money works.</strong> {d.disclosure}</div>
      <section className="border border-ink/10 p-5 mb-6"><h2 className="font-serif text-lg mb-2">Terms</h2><p className="text-[12px] text-slate whitespace-pre-wrap leading-relaxed">{d.terms}</p><p className="text-[11px] text-mist mt-3">Silence for {d.approval_window_days} days after a delivery is submitted counts as approval. You can open a dispute instead before then.</p></section>
      {err && <p className="text-[#9B2C2C] text-[12px] mb-4" role="alert">{err}</p>}

      <section className="border border-ink/10 p-5 mb-6">
        <h2 className="font-serif text-lg mb-3">Milestones</h2>
        {d.milestones.map((m: any) => (
          <div key={m.id} className="border-t border-ink/10 first:border-0 py-4 text-[12px]">
            <div className="flex flex-wrap items-center gap-3"><strong>{m.seq}. {m.title}</strong><span>{d.currency} {major(m.amount, d.currency)}</span><Chip status={TONE[m.status] ?? "DRAFT"} label={m.status} />{m.pay_timing === "UPFRONT" && d.mode === "PAY_ON_APPROVAL" && <span className="text-mist">pay upfront</span>}{m.paid && <span className="text-[#2D6A4F]">paid</span>}</div>
            {m.description && <p className="text-slate mt-1">{m.description}</p>}
            {m.submission_note && <p className="text-slate mt-1">Seller's note: {m.submission_note}</p>}
            {m.dispute && <p className="text-[#9A4B12] mt-1">Dispute ({m.dispute.opened_by?.toLowerCase()}): {m.dispute.reason}{m.dispute.resolution ? ` — resolved: ${m.dispute.resolution}` : " — under review by our team"}</p>}
            {d.status === "ACTIVE" && (
              <div className="flex flex-wrap gap-3 mt-2">
                {m.pay_url && <a className="btn-gold !py-2 !px-4" href={m.pay_url}>Pay this milestone</a>}
                {d.mode === "PARTNER_ESCROW" && m.status === "PENDING" && <button className="btn-ghost !py-2 !px-4" onClick={() => showFunding(m.id)}>How to fund it</button>}
                {m.status === "SUBMITTED" && <button className="btn-primary !py-2 !px-4" onClick={() => act(`milestones/${m.id}/approve`)}>Approve delivery</button>}
                {["SUBMITTED", "FUNDED"].includes(m.status) && <button className="text-[#9B2C2C] text-[11px] uppercase tracking-widest" onClick={() => setDispute({ id: m.id, reason: "" })}>Open a dispute</button>}
              </div>
            )}
            {fund[m.id] && (
              <div className="mt-3 border border-ink/10 p-3 text-[11px] leading-relaxed">
                <div className="text-mist uppercase tracking-widest text-[9px] mb-1">Send to the escrow agent</div>
                {Object.entries(fund[m.id].bankDetails as Record<string, string>).map(([k, v]) => <div key={k}><span className="text-mist">{k.replace(/_/g, " ")}:</span> <span className="select-all">{v}</span></div>)}
                <div className="text-[#9A4B12] mt-1">Use the reference exactly. The agent confirms receipt and this page updates.</div>
              </div>
            )}
            {reasonFor(m.id) !== null && (() => { const reason = reasonFor(m.id) ?? ""; return (
              <div className="mt-3">
                <textarea className="input-field" rows={3} placeholder="What is wrong? (at least 10 characters)" value={reason} onChange={e => setDispute({ id: m.id, reason: e.target.value })} aria-label="Dispute reason" />
                <div className="flex gap-3 mt-2"><button className="btn-primary !py-2 !px-4 disabled:opacity-40" disabled={reason.trim().length < 10} onClick={() => { act(`milestones/${m.id}/dispute`, { reason }); setDispute(null); }}>Send dispute</button><button className="btn-ghost !py-2 !px-4" onClick={() => setDispute(null)}>Cancel</button></div>
              </div>
            ); })()}
          </div>))}
      </section>

      {open && (
        <div className="flex gap-3">
          <button className="btn-gold" onClick={() => act("accept")}>Accept this deal</button>
          <button className="btn-ghost" onClick={() => act("decline")}>Decline</button>
        </div>
      )}
      <p className="text-[10px] text-mist mt-8 leading-relaxed max-w-xl">Anyone with this link can act for the buyer, so keep it private. Vaulte is a software platform and does not hold your funds. This is not legal advice; read the terms before accepting.</p>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper font-mono">
      <div className="border-b border-ink/10 px-6 py-4 font-serif text-xl text-ink">Vaulte</div>
      <main className="max-w-2xl mx-auto px-6 py-10">{children}</main>
    </div>
  );
}
