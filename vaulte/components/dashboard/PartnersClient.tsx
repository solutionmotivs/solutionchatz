"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { ErrorBox } from "@/components/auth/AuthShell";
import { Chip, Section, Shell } from "@/components/verification/shared";

interface Row { id: string; partner: string; mode: "test" | "live"; status: string; note: string | null; action_url?: string | null; submitted_at: string | null; decided_at: string | null }

const NEXT_STEP: Record<string, string> = {
  INVITED: "Not sent yet. Start onboarding and Vaulte sends your verified details.",
  SUBMITTED: "With the partner. Nothing for you to do; the decision arrives here automatically.",
  NEEDS_INFO: "The partner needs one more thing. Do it below; you will not be emailed separately.",
  APPROVED: "Approved. Payments can use this partner.",
  REJECTED: "The partner declined. Contact support with the note below.",
};

export default function PartnersClient({ role }: { role: string }) {
  const canWrite = ["OWNER", "ADMIN"].includes(role);
  const [rows, setRows] = useState<Row[]>([]); const [note, setNote] = useState("");
  const [partner, setPartner] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { const r = await api("/api/partner-customers"); if (r.ok) { setRows(r.data.data); setNote(r.data.note); } }, []);
  useEffect(() => { load(); const t = setInterval(load, 20_000); return () => clearInterval(t); }, [load]);

  async function start() {
    setErr(""); setBusy(true);
    const r = await api("/api/partner-customers", { body: { partner: partner.trim().toLowerCase() } });
    setBusy(false);
    if (!r.ok) return setErr(r.error?.message ?? "Could not start onboarding");
    setPartner(""); load();
  }

  return (
    <Shell title="Partner approvals" right={<a className="text-mist hover:text-ink" href="/dashboard">Dashboard</a>}>
      <p className="text-[12px] text-slate leading-relaxed max-w-2xl mb-6">Licensed partners hold, convert and pay out your money, so each one approves you first. You verify once with Vaulte; we send the partner your verified details and show its decision here. If a partner needs something more, it appears on this page with the exact step. {note}</p>
      {err && <ErrorBox message={err} />}
      <Section title="Your partner approvals">
        {rows.length === 0 ? <p className="text-[12px] text-mist">No partner has been asked yet. Approvals start automatically with your first quote, or start one below.</p> : rows.map(r => (
          <div key={r.id} className="border-t border-ink/10 py-4 first:border-t-0">
            <div className="flex flex-wrap items-center gap-3">
              <strong className="text-[13px] capitalize">{r.partner.replace(/_/g, " ")}</strong>
              <Chip status={r.status} />
              <span className="text-[10px] uppercase tracking-widest text-mist">{r.mode === "test" ? "test mode" : "live"}</span>
            </div>
            <p className="text-[12px] text-slate mt-2">{NEXT_STEP[r.status] ?? ""}</p>
            {r.note && <p className="text-[11px] text-mist mt-1">{r.note}</p>}
            {r.status === "NEEDS_INFO" && r.action_url && /^https:\/\//.test(r.action_url) && (
              <a className="btn-primary inline-block mt-3" href={r.action_url} target="_blank" rel="noopener noreferrer">Complete the partner&apos;s step</a>
            )}
            {r.status === "NEEDS_INFO" && !r.action_url && <p className="text-[11px] text-[#9A4B12] mt-2">Check your verification page for missing details, then we resend them automatically.</p>}
          </div>
        ))}
      </Section>
      {canWrite && (
        <Section title="Start onboarding with a partner" hint="Use the partner's id, for example nium, currencycloud or airwallex.">
          <div className="flex gap-3 items-end"><div className="flex-1 max-w-xs"><label className="label-text">Partner</label><input className="input-field" value={partner} onChange={e => setPartner(e.target.value)} placeholder="nium" /></div>
            <button className="btn-primary disabled:opacity-40" disabled={busy || partner.trim().length < 2} onClick={start}>{busy ? "Sending…" : "Start"}</button></div>
        </Section>
      )}
    </Shell>
  );
}
