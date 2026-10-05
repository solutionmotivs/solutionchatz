"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { ErrorBox } from "@/components/auth/AuthShell";
import { Chip, Section, Shell } from "@/components/verification/shared";

export default function StaffEscrow() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => { const r = await api("/api/admin/escrow/disputes"); if (r.ok) setRows(r.data.data); else { setErr(r.error?.message ?? "Failed"); setRows([]); } }, []);
  useEffect(() => { load(); }, [load]);
  async function resolve(id: string, resolution: "RELEASE" | "REFUND") {
    const note = window.prompt(`Reasoning for ${resolution.toLowerCase()} (recorded, at least 10 characters)`);
    if (!note) return;
    const r = await api(`/api/admin/escrow/milestones/${id}/resolve`, { body: { resolution, note } });
    if (!r.ok) setErr(r.error?.message ?? "Failed"); else load();
  }
  return (
    <Shell title="Escrow disputes" back={{ href: "/admin", label: "Review queue" }}>
      <p className="text-[11px] text-mist max-w-2xl mb-6">Read both sides and the delivery note, then decide. <strong>Release</strong> pays the seller; <strong>Refund</strong> returns the buyer's money through the escrow agent (or cancels the milestone in pay-on-approval deals; a prepaid amount is returned by the payment partner, arrange it). Decisions are logged with your reasoning and cannot be changed.</p>
      {err && <ErrorBox message={err} />}
      <Section title="Open disputes">
        {rows === null ? <p className="text-[11px] text-mist">Loading…</p> : rows.length === 0 ? <p className="text-[12px] text-mist">Nothing in dispute.</p> : rows.map(r => (
          <div key={r.milestone_id} className="border-t border-ink/10 first:border-0 py-3 text-[12px]">
            <div className="flex flex-wrap items-center gap-3"><strong>{r.deal}</strong><span className="text-mist">seller {r.seller} · buyer {r.buyer} · milestone {r.seq} “{r.title}”</span><Chip status="REJECTED" label={`opened by ${String(r.opened_by).toLowerCase()}`} /><span>{r.currency} {(r.amount / 100).toLocaleString()}</span></div>
            <p className="mt-1">Reason: {r.reason}</p>{r.submission_note && <p className="text-mist">Seller's delivery note: {r.submission_note}</p>}
            <div className="flex gap-4 mt-2"><button className="text-[#2D6A4F] text-[10px] uppercase tracking-widest" onClick={() => resolve(r.milestone_id, "RELEASE")}>Release to seller</button><button className="text-[#9B2C2C] text-[10px] uppercase tracking-widest" onClick={() => resolve(r.milestone_id, "REFUND")}>Refund buyer</button></div>
          </div>))}
      </Section>
    </Shell>
  );
}
