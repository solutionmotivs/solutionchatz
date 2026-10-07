"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { ErrorBox } from "@/components/auth/AuthShell";
import { Section, Shell } from "@/components/verification/shared";

const STATUSES = ["NEW", "CONTACTED", "PILOT", "PAUSED", "CLOSED"];

export default function StaffLeads() {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState(""); const [filter, setFilter] = useState("");
  const load = useCallback(async () => { const r = await api(`/api/admin/leads${filter ? `?status=${filter}` : ""}`); if (r.ok) setD(r.data); else setErr(r.error?.message ?? "Failed"); }, [filter]);
  useEffect(() => { load(); }, [load]);
  async function move(id: string, status: string) { const r = await fetch("/api/admin/leads", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status }) }); if (!r.ok) setErr("Could not update"); else load(); }
  return (
    <Shell title="Pilot leads" back={{ href: "/admin", label: "Review queue" }}>
      <ErrorBox message={err} />
      <Section title="Pipeline" hint={d ? STATUSES.map(s => `${s} ${d.counts[s] ?? 0}`).join(" · ") : undefined}>
        <div className="flex gap-3 mb-4 text-[11px]">{["", ...STATUSES].map(s => <button key={s} className={filter === s ? "text-ink underline" : "text-mist hover:text-ink"} onClick={() => setFilter(s)}>{s || "ALL"}</button>)}</div>
        {!d ? "Loading…" : d.data.length === 0 ? <p className="text-[12px] text-mist">No leads yet.</p> : d.data.map((l: any) => (
          <div key={l.id} className="border-t border-ink/10 first:border-0 py-3 text-[12px]">
            <div className="flex flex-wrap items-center gap-3"><strong>{l.company}</strong><span>{l.name} · <a className="text-gold" href={`mailto:${l.email}`}>{l.email}</a> · {l.country}</span><span className="text-mist">{l.corridor ?? ""} {l.volume_band ?? ""}</span>
              <select className="ml-auto input-field !py-1 !w-auto" value={l.status} onChange={e => move(l.id, e.target.value)}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></div>
            {l.use_case && <div className="text-mist mt-1">{l.use_case}</div>}
          </div>))}
      </Section>
    </Shell>
  );
}
