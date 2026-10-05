"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { ErrorBox } from "@/components/auth/AuthShell";
import { Chip, PURPOSE_LABELS, Section, Shell } from "@/components/verification/shared";

export default function StaffCase({ id, staffId }: { id: string; staffId: string }) {
  const [c, setC] = useState<any>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    const r = await api(`/api/admin/verification/${id}`);
    if (r.ok) setC(r.data); else setErr(r.error?.message ?? "Could not load");
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!c) return <Shell title="Review" back={{ href: "/admin", label: "Queue" }}>{err ? <ErrorBox message={err} /> : <p className="text-[11px] text-mist">Loading…</p>}</Shell>;
  const inReview = c.status === "IN_REVIEW";
  const blocked = !!c.screening?.blocked;
  const iApproved = (c.approvals ?? []).some((a: any) => a.staffId === staffId);

  async function decide(decision: string) {
    setErr(""); setMsg("");
    const r = await api(`/api/admin/verification/${id}/decision`, { body: { decision, note: note || undefined } });
    if (!r.ok) return setErr(r.error?.message ?? "Failed");
    setMsg(r.data.status === "IN_REVIEW" ? `Approval recorded (${r.data.approvals}/${r.data.needed}). A second reviewer must approve.` : `Case ${r.data.status.toLowerCase().replace("_", " ")}.`);
    setNote(""); load();
  }
  async function docDecision(docId: string, status: string) {
    const reason = status === "REJECTED" ? window.prompt("Reason for rejecting this document?") : undefined;
    if (status === "REJECTED" && !reason) return;
    const r = await api(`/api/admin/verification/${id}/documents/${docId}`, { body: { status, reason } });
    if (!r.ok) setErr(r.error?.message ?? "Failed"); else load();
  }
  async function itemDecision(code: string, status: string) {
    const n = window.prompt(`Note for marking ${code} ${status.toLowerCase()} (what did you check?)`);
    if (!n) return;
    const r = await api(`/api/admin/verification/${id}/items/${code}`, { body: { status, note: n } });
    if (!r.ok) setErr(r.error?.message ?? "Failed"); else load();
  }

  return (
    <Shell title={`${c.kind} review — ${c.profile?.legal_name ?? c.people?.[0]?.full_name ?? c.organization?.name}`} back={{ href: "/admin", label: "Queue" }}>
      <div className="flex flex-wrap gap-3 items-center mb-6 text-[11px] text-slate">
        <Chip status={c.status} /> <span>{c.organization?.name}</span><span>·</span><span>{c.country}</span><span>·</span>
        <span>{c.purposes.map((p: string) => PURPOSE_LABELS[p] ?? p).join(", ")}</span>
        {c.tier && <><span>·</span><strong>Level {c.tier}</strong></>}{c.risk_score != null && <><span>·</span><span>Risk {c.risk_score}/100</span></>}
      </div>
      {blocked && <div className="border border-[#9B2C2C]/40 bg-[#9B2C2C]/5 px-4 py-3 text-[12px] mb-6">This case hit a prohibited jurisdiction or a sanctions match. It cannot be approved.</div>}
      {err && <ErrorBox message={err} />}{msg && <p className="text-[12px] text-[#2D6A4F] mb-4">{msg}</p>}

      <Section title="Risk assessment">
        {(c.risk_factors ?? []).length === 0 ? <p className="text-[11px] text-mist">No risk factors.</p> : (
          <table className="w-full text-[12px]"><tbody>{c.risk_factors.map((f: any) => <tr key={f.code} className="border-t border-ink/10 first:border-0"><td className="py-2">{f.code.replace(/_/g, " ").toLowerCase()}</td><td className="text-mist">{f.detail}</td><td className="text-right">+{f.points}</td></tr>)}</tbody></table>
        )}
        {c.screening?.hits?.length > 0 && <div className="mt-4"><div className="label-text">Screening hits</div>{c.screening.hits.map((h: any, i: number) => <p key={i} className="text-[12px]">{h.name} — {h.match.replace("_", " ").toLowerCase()} ({h.lists.join(", ")}), score {h.score}</p>)}</div>}
      </Section>

      <Section title="Profile">
        <table className="w-full text-[12px]"><tbody>{Object.entries(c.profile ?? {}).map(([k, v]) => <tr key={k} className="border-t border-ink/10 first:border-0"><td className="py-2 text-mist w-1/3">{k.replace(/_/g, " ")}</td><td>{String(v)}</td></tr>)}</tbody></table>
      </Section>

      <Section title="Identifiers">
        {c.items.map((it: any) => (
          <div key={it.code} className="border-t border-ink/10 first:border-0 py-3 text-[12px]">
            <div className="flex flex-wrap gap-3 items-center"><strong>{it.code}</strong><span className="text-mist">{it.masked}</span><Chip status={it.status} /><span className="text-mist">{it.provider ?? ""}</span>
              {inReview && <><button className="text-[#2D6A4F] text-[10px] uppercase tracking-widest" onClick={() => itemDecision(it.code, "VERIFIED")}>Mark verified</button><button className="text-[#9B2C2C] text-[10px] uppercase tracking-widest" onClick={() => itemDecision(it.code, "FAILED")}>Mark failed</button></>}
            </div>
            {it.details && <p className="text-[11px] text-mist mt-1">{Object.entries(it.details).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>}
          </div>
        ))}
      </Section>

      <Section title="People">
        {c.people.map((p: any) => <p key={p.id} className="text-[12px] py-1">{p.full_name} — {p.role}{p.ownership_pct != null ? ` ${p.ownership_pct}%` : ""} · {p.nationality ?? "?"}/{p.country_of_residence ?? "?"}{p.date_of_birth ? ` · born ${p.date_of_birth}` : ""}{p.is_pep ? " · PEP" : ""}{p.pan_masked ? ` · PAN ${p.pan_masked} (${p.pan_status ?? "?"})` : ""}</p>)}
      </Section>

      <Section title="Documents" hint="Opening a document is recorded in the audit log.">
        {c.documents.map((d: any) => (
          <div key={d.id} className="flex flex-wrap items-center gap-3 border-t border-ink/10 first:border-0 py-2 text-[12px]">
            <span className="w-48">{d.type.replace(/_/g, " ").toLowerCase()}</span>
            <a className="text-gold hover:underline" target="_blank" rel="noreferrer" href={`/api/admin/verification/${id}/documents/${d.id}`}>{d.filename}</a><Chip status={d.status} />
            {d.reject_reason && <span className="text-[#9B2C2C]">{d.reject_reason}</span>}
            {inReview && <><button className="text-[#2D6A4F] text-[10px] uppercase tracking-widest" onClick={() => docDecision(d.id, "ACCEPTED")}>Accept</button><button className="text-[#9B2C2C] text-[10px] uppercase tracking-widest" onClick={() => docDecision(d.id, "REJECTED")}>Reject</button></>}
          </div>
        ))}
      </Section>

      {inReview && (
        <Section title="Decision" hint={c.tier === "EDD" ? "Enhanced due diligence: two different reviewers must approve." : undefined}>
          <textarea className="input-field mb-4" rows={3} placeholder="Note (required to reject or request information; shown to the customer)" value={note} onChange={e => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-3">
            <button className="btn-gold disabled:opacity-40" disabled={blocked || iApproved} onClick={() => decide("APPROVE")}>{iApproved ? "You approved — waiting for a second reviewer" : "Approve"}</button>
            <button className="btn-ghost" onClick={() => decide("REQUEST_INFO")}>Request more information</button>
            <button className="btn-ghost !text-[#9B2C2C]" onClick={() => decide("REJECT")}>Reject</button>
          </div>
        </Section>
      )}
    </Shell>
  );
}
