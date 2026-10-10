"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { ErrorBox } from "@/components/auth/AuthShell";
import { Chip, Section, Shell } from "@/components/verification/shared";

export default function SanctionsAlerts() {
  const [tab, setTab] = useState("OPEN");
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState({ name: "", kind: "ENTITY", country: "", address: "" });
  const [res, setRes] = useState<any>(null);

  const load = useCallback(async () => {
    setData(null);
    const r = await api(`/api/admin/sanctions?status=${tab}`);
    if (r.ok) setData(r.data); else { setErr(r.error?.message ?? "Failed"); setData({ data: [], lists: [] }); }
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  async function decide(id: string, decision: string) {
    const note = window.prompt(decision === "CLEAR" ? "Why is this a false positive? (what did you compare?)" : "What confirms this is the listed party?");
    if (!note || note.length < 5) return;
    const r = await api(`/api/admin/sanctions/${id}`, { body: { decision, note } });
    if (!r.ok) setErr(r.error?.message ?? "Failed"); else load();
  }
  async function search() {
    setErr(""); setRes(null);
    const body = q.address ? { address: q.address } : { name: q.name, kind: q.kind, ...(q.country ? { country: q.country.toUpperCase() } : {}) };
    const r = await api("/api/admin/sanctions/search", { body });
    if (r.ok) setRes(r.data); else setErr(r.error?.message ?? "Failed");
  }

  return (
    <Shell title="Sanctions screening" back={{ href: "/admin", label: "Review queue" }}>
      {err && <ErrorBox message={err} />}
      <Section title="List status" hint="Lists are refreshed by the daily sync job. If a list is older than 48 hours or failed, fix that before approving anything.">
        {data?.lists?.length ? (
          <table className="w-full text-[12px]"><thead><tr className="text-left text-[9px] uppercase tracking-widest text-mist"><th className="py-2">List</th><th>Entries</th><th>Wallet addresses</th><th>Refreshed</th><th>Status</th></tr></thead>
            <tbody>{data.lists.map((l: any) => <tr key={l.code} className="border-t border-ink/10"><td className="py-2">{l.code}</td><td>{l.entries}</td><td>{l.addresses}</td><td>{new Date(l.fetched_at).toLocaleString()}</td><td><Chip status={l.status === "OK" ? "APPROVED" : "REJECTED"} label={l.status} />{l.error ? ` ${l.error}` : ""}</td></tr>)}</tbody></table>
        ) : <p className="text-[12px] text-[#9B2C2C]">No lists loaded. Run the sync job.</p>}
      </Section>

      <Section title="Check a name or wallet">
        <div className="grid sm:grid-cols-4 gap-3">
          <input className="input-field sm:col-span-2" placeholder="Name" value={q.name} onChange={e => setQ({ ...q, name: e.target.value, address: "" })} />
          <select className="input-field" value={q.kind} onChange={e => setQ({ ...q, kind: e.target.value })}><option value="ENTITY">Business</option><option value="INDIVIDUAL">Person</option></select>
          <input className="input-field" placeholder="Country (IN)" maxLength={2} value={q.country} onChange={e => setQ({ ...q, country: e.target.value })} />
          <input className="input-field sm:col-span-3" placeholder="…or a wallet address" value={q.address} onChange={e => setQ({ ...q, address: e.target.value, name: "" })} />
          <button className="btn-primary" onClick={search} disabled={!q.name && !q.address}>Check</button>
        </div>
        {res && <div className="mt-4 text-[12px]"><Chip status={res.outcome === "CLEAR" ? "APPROVED" : res.outcome === "BLOCK" ? "REJECTED" : "IN_REVIEW"} label={res.outcome} />
          {(res.matches ?? []).map((m: any, i: number) => <p key={i} className="mt-2">{m.listedName ?? m.address} <span className="text-mist">({m.list}{m.score ? `, score ${m.score}` : ""}{m.matchedVariant && m.matchedVariant !== m.listedName ? `, matched as "${m.matchedVariant}"` : ""})</span></p>)}</div>}
      </Section>

      <div className="flex gap-1 border-b border-ink/10 mb-6">
        {[["OPEN", "Open alerts"], ["CLEARED", "Cleared"], ["CONFIRMED", "Confirmed"]].map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`px-4 py-3 text-[11px] uppercase tracking-widest ${tab === id ? "text-ink border-b-2 border-gold" : "text-mist hover:text-ink"}`}>{label}</button>)}
      </div>
      {data === null ? <p className="text-[11px] text-mist">Loading…</p> : data.data.length === 0 ? <p className="text-[11px] text-mist">Nothing here.</p> : data.data.map((a: any) => (
        <div key={a.id} className="border border-ink/10 p-5 mb-4">
          <div className="flex flex-wrap items-center gap-3 text-[12px] mb-2">
            <Chip status={a.result === "BLOCK" ? "REJECTED" : "IN_REVIEW"} label={a.result} /><strong>{a.query.name ?? a.query.address}</strong>
            <span className="text-mist">{a.subject_type.replace(/_/g, " ").toLowerCase()} · {a.organization ?? "—"} · {new Date(a.created_at).toLocaleString()} · score {a.top_score}</span>
          </div>
          {(a.matches ?? []).slice(0, 4).map((m: any, i: number) => (
            <p key={i} className="text-[12px] text-slate">→ {m.listedName} <span className="text-mist">[{m.list} {m.externalId ?? ""}{m.programs?.length ? `, ${m.programs.join("/")}` : ""}] {m.score ? `score ${m.score}` : ""}{m.dobConsistent === true ? " · birth year matches" : m.dobConsistent === false ? " · birth year differs" : ""}</span></p>
          ))}
          {a.note && <p className="text-[11px] text-mist mt-2">Note: {a.note}</p>}
          {a.status === "OPEN" && <div className="mt-3 flex gap-4"><button className="text-[#2D6A4F] text-[10px] uppercase tracking-widest" onClick={() => decide(a.id, "CLEAR")}>Clear: false positive</button><button className="text-[#9B2C2C] text-[10px] uppercase tracking-widest" onClick={() => decide(a.id, "CONFIRM")}>Confirm match</button></div>}
        </div>
      ))}
      <p className="text-[10px] text-mist mt-8 leading-relaxed max-w-2xl">A confirmed match blocks the party. Whether to freeze funds, file a blocking or suspicious-activity report, or inform a regulator is a legal decision for your compliance officer and counsel; this tool records the decision, it does not file reports.</p>
    </Shell>
  );
}
