"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { ErrorBox } from "@/components/auth/AuthShell";
import { COUNTRIES } from "@/lib/countries";
import { Chip, ProgressBar, PURPOSE_LABELS, Section, Shell } from "./shared";

export default function VerificationCase({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [c, setC] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const r = await api(`/api/verification/${id}`);
    if (r.ok) setC(r.data); else setErr(r.error?.message ?? "Could not load");
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!c) return <Shell title="Verification" back={{ href: "/dashboard/verification", label: "All verifications" }}>{err ? <ErrorBox message={err} /> : <p className="text-[11px] text-mist">Loading…</p>}</Shell>;

  const editable = canEdit && (c.status === "DRAFT" || c.status === "NEEDS_INFO");
  const req = c.requirements;
  const apply = (data: any) => setC(data);

  async function submit() {
    setErr(""); setBusy("submit");
    const r = await api(`/api/verification/${id}/submit`, { body: {} });
    setBusy("");
    if (!r.ok) return setErr(r.error?.message ?? "Could not submit");
    apply(r.data.case);
  }

  return (
    <Shell title={c.kind === "KYB" ? "Business verification" : "Identity verification"} back={{ href: "/dashboard/verification", label: "All verifications" }}>
      <div className="flex flex-wrap gap-3 items-center mb-6 text-[11px] text-slate">
        <Chip status={c.status} /> <span>{c.country}</span> <span>·</span> <span>{c.purposes.map((p: string) => PURPOSE_LABELS[p] ?? p).join(", ")}</span>
        {c.tier && <><span>·</span><span>Level {c.tier}</span></>}
      </div>

      {c.status === "APPROVED" && c.limits && (
        <Banner tone="ok">Approved. Limits for this verification level: up to USD {c.limits.perTxnUsd.toLocaleString("en-US")} per transfer, USD {c.limits.dailyUsd.toLocaleString("en-US")} per day and USD {c.limits.monthlyUsd.toLocaleString("en-US")} per 30 days. Next periodic review: {c.next_review_at ? new Date(c.next_review_at).toLocaleDateString() : "—"}.</Banner>
      )}
      {(c.status === "IN_REVIEW" || c.status === "SUBMITTED") && <Banner tone="wait">Submitted. Our team is reviewing your information. You will get an email when there is an update.</Banner>}
      {c.status === "NEEDS_INFO" && <Banner tone="warn"><strong>More information needed.</strong> {c.decision_note}</Banner>}
      {c.status === "REJECTED" && <Banner tone="bad"><strong>Not approved.</strong> {c.decision_note}</Banner>}
      {editable && c.progress && <ProgressBar {...c.progress} />}
      {req.registry_info && (
        <p className="text-[11px] text-slate mb-4 leading-relaxed">
          Official source for {c.country}: <a className="text-gold hover:underline" href={req.registry_info.url} target="_blank" rel="noopener noreferrer">{req.registry_info.name}</a>.
          {req.registry_info.mode === "MANUAL" ? " We cannot check this register automatically yet, so a reviewer will confirm your numbers against your documents." : " Where we can, we look your number up there and fill in the registered name."}
        </p>
      )}
      {req.notes.length > 0 && <ul className="mb-6 text-[11px] text-slate leading-relaxed list-disc pl-5">{req.notes.map((n: string) => <li key={n}>{n}</li>)}</ul>}
      {err && <ErrorBox message={err} />}

      <ProfileSection key={JSON.stringify(c.profile ?? {})} c={c} editable={editable} onSaved={apply} setErr={setErr} />
      <ItemsSection c={c} editable={editable} onSaved={apply} setErr={setErr} />
      <PeopleSection c={c} editable={editable} onSaved={apply} setErr={setErr} />
      <DocsSection c={c} editable={editable} onSaved={apply} setErr={setErr} />

      {editable && (
        <Section title="Submit for review">
          {c.missing.length > 0 ? (
            <>
              <p className="text-[11px] text-slate mb-2">Still needed before you can submit:</p>
              <ul className="list-disc pl-5 text-[12px] text-ink mb-4">{c.missing.map((m: any) => <li key={m.section + m.key}>{m.label}</li>)}</ul>
            </>
          ) : <p className="text-[12px] text-slate mb-4">Everything required is in. Submitting runs sanctions screening and risk assessment, then sends the case to a reviewer.</p>}
          <button className="btn-gold disabled:opacity-40" disabled={c.missing.length > 0 || busy === "submit"} onClick={submit}>{busy === "submit" ? "Checking…" : "Submit for review →"}</button>
        </Section>
      )}
    </Shell>
  );
}

function Banner({ tone, children }: { tone: "ok" | "wait" | "warn" | "bad"; children: React.ReactNode }) {
  const cls = { ok: "border-[#2D6A4F]/40 bg-[#2D6A4F]/5", wait: "border-gold/50 bg-gold/5", warn: "border-[#9A4B12]/40 bg-[#9A4B12]/5", bad: "border-[#9B2C2C]/40 bg-[#9B2C2C]/5" }[tone];
  return <div className={`border ${cls} px-4 py-3 text-[12px] text-ink leading-relaxed mb-6`}>{children}</div>;
}

type SectionProps = { c: any; editable: boolean; onSaved: (c: any) => void; setErr: (m: string) => void };

function ProfileSection({ c, editable, onSaved, setErr }: SectionProps) {
  const [form, setForm] = useState<Record<string, any>>(c.profile ?? {});
  const [saved, setSaved] = useState(false);
  async function save() {
    setErr(""); setSaved(false);
    const r = await api(`/api/verification/${c.id}`, { method: "PATCH", body: { profile: form } });
    if (!r.ok) return setErr(r.error?.message ?? "Could not save");
    onSaved(r.data); setSaved(true);
  }
  return (
    <Section title={c.kind === "KYB" ? "About the business" : "About you"}>
      <div className="grid sm:grid-cols-2 gap-4">
        {req(c).profile.map((f: any) => (
          <div key={f.key} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
            <label className="label-text">{f.label}{f.required ? " *" : ""}</label>
            {f.type === "select" ? (
              <select className="input-field" disabled={!editable} value={form[f.key] ?? ""} onChange={e => setForm({ ...form, [f.key]: e.target.value })}>
                <option value="">Select…</option>{f.options.map((o: string) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
              </select>
            ) : f.type === "textarea" ? (
              <textarea className="input-field" rows={2} disabled={!editable} value={form[f.key] ?? ""} onChange={e => setForm({ ...form, [f.key]: e.target.value })} />
            ) : (
              <input className="input-field" type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} disabled={!editable} value={form[f.key] ?? ""} onChange={e => setForm({ ...form, [f.key]: e.target.value })} />
            )}
          </div>
        ))}
      </div>
      {editable && <div className="mt-4 flex items-center gap-4"><button className="btn-primary" onClick={save}>Save details</button>{saved && <span className="text-[11px] text-[#2D6A4F]">Saved</span>}</div>}
    </Section>
  );
}
const req = (c: any) => c.requirements;

function ItemsSection({ c, editable, onSaved, setErr }: SectionProps) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<Record<string, string>>({});
  const [found, setFound] = useState<Record<string, any>>({});
  async function lookup(code: string) {
    const value = (vals[code] ?? "").trim();
    if (value.length < 4) return;
    setErr(""); setBusy("L" + code);
    const q = new URLSearchParams({ country: c.country, code, value });
    const legal = (c.profile as any)?.legal_name; if (legal) q.set("name", legal);
    const r = await api(`/api/verification/lookup?${q}`);
    setBusy("");
    if (!r.ok) { setFound({ ...found, [code]: { error: r.error?.message ?? "Lookup failed" } }); return; }
    setFound({ ...found, [code]: r.data });
  }
  async function useName(code: string, name: string, address?: string | null) {
    const patch: Record<string, string> = { legal_name: name };
    if (address && !(c.profile as any)?.address) patch.address = address;
    const r = await api(`/api/verification/${c.id}`, { method: "PATCH", body: { profile: patch } });
    if (r.ok) onSaved(r.data); else setErr(r.error?.message ?? "Could not save");
  }
  async function save(code: string) {
    setErr(""); setBusy(code);
    const r = await api(`/api/verification/${c.id}/items/${code}`, { method: "PUT", body: { value: vals[code] ?? "" } });
    setBusy("");
    if (!r.ok) return setErr(r.error?.message ?? "Could not save");
    onSaved(r.data.case);
    setVals({ ...vals, [code]: "" });
    const name = r.data.registered_name ? ` Registered name: ${r.data.registered_name}.` : "";
    setNote({ ...note, [code]: r.data.result.status === "VERIFIED" ? `Verified.${name}` : r.data.result.status === "FAILED" ? `Check failed: ${r.data.result.reason ?? "does not match"}` : `Saved; a reviewer will confirm it.${name}` });
  }
  return (
    <Section title="Registrations and bank account" hint="Numbers are encrypted. Where an official source can be checked automatically, we do it as soon as you save, and we can fill in the registered legal name for you.">
      {req(c).items.map((it: any) => {
        const have = c.items.find((x: any) => x.code === it.code);
        const f = found[it.code];
        return (
          <div key={it.code} className="border-t border-ink/10 first:border-0 py-4">
            <div className="flex flex-wrap items-center gap-3 mb-1">
              <span className="text-[12px] text-ink">{it.label}{it.required ? " *" : ""}</span>
              {have && <><Chip status={have.status} /><span className="text-[11px] text-mist">{have.masked}</span></>}
              {it.registry && it.autoVerifiable && <span className="text-[9px] uppercase tracking-widest text-gold">auto-check</span>}
            </div>
            <p className="text-[10px] text-mist mb-2">{it.help}</p>
            {have?.details?.registered_name && <p className="text-[11px] text-slate mb-2">Registered name on file: <strong>{String(have.details.registered_name)}</strong></p>}
            {have?.status === "FAILED" && <p className="text-[11px] text-[#9B2C2C] mb-2">{have.details?.reason ?? "This did not verify."} Please correct and save again.</p>}
            {note[it.code] && have?.status !== "FAILED" && <p className="text-[11px] text-slate mb-2">{note[it.code]}</p>}
            {editable && (
              <div className="flex gap-2">
                <input className="input-field" placeholder={have ? "Enter a new value to replace" : "Enter value"} value={vals[it.code] ?? ""} onChange={e => setVals({ ...vals, [it.code]: e.target.value })} onBlur={() => { if (it.registry && it.autoVerifiable) lookup(it.code); }} autoComplete="off" />
                {it.registry && it.autoVerifiable && <button className="btn-ghost whitespace-nowrap disabled:opacity-40" disabled={!vals[it.code] || busy === "L" + it.code} onClick={() => lookup(it.code)}>{busy === "L" + it.code ? "Looking up…" : "Look up"}</button>}
                <button className="btn-ghost whitespace-nowrap disabled:opacity-40" disabled={!vals[it.code] || busy === it.code} onClick={() => save(it.code)}>{busy === it.code ? "Checking…" : "Save & check"}</button>
              </div>
            )}
            {editable && f && !f.error && (
              <div className="mt-2 border border-ink/10 px-3 py-2 text-[11px] text-slate leading-relaxed">
                {f.status === "FOUND" && <>
                  <div><strong className="text-ink">{f.legal_name ?? "Found (no name published)"}</strong>{f.active === false ? " · not active" : ""}</div>
                  {f.address && <div>{f.address}</div>}
                  {f.name_match != null && f.name_match < 0.5 && <div className="text-[#9A4B12]">This differs from the name you entered; a reviewer will compare them.</div>}
                  {f.legal_name && <button className="text-gold hover:underline mt-1" onClick={() => useName(it.code, f.legal_name, f.address)}>Use this as my legal name</button>}
                  <div className="text-[10px] text-mist mt-1">Source: <a className="hover:underline" href={f.source_url} target="_blank" rel="noopener noreferrer">{f.source}</a></div>
                </>}
                {f.status === "NOT_FOUND" && <div className="text-[#9B2C2C]">{f.reason ?? "Not found in the official register."} Check the number and try again.</div>}
                {f.status === "UNAVAILABLE" && <div>The official register could not be reached ({f.reason}). You can still save; a reviewer will confirm it.</div>}
              </div>
            )}
            {editable && f?.error && <p className="mt-2 text-[11px] text-[#9A4B12]">{f.error}</p>}
          </div>
        );
      })}
    </Section>
  );
}

function PeopleSection({ c, editable, onSaved, setErr }: SectionProps) {
  const roles = req(c).people as { role: string; label: string; min: number }[];
  const [f, setF] = useState<any>({ role: roles[0]?.role, full_name: "", date_of_birth: "", nationality: c.country, country_of_residence: c.country, ownership_pct: "", is_pep: false, pan: "", id_type: "" });
  async function add() {
    setErr("");
    const body: any = { role: f.role, full_name: f.full_name, is_pep: f.is_pep };
    for (const k of ["date_of_birth", "nationality", "country_of_residence", "pan", "id_type"]) if (f[k]) body[k] = f[k];
    if (f.role === "UBO") body.ownership_pct = Number(f.ownership_pct);
    const r = await api(`/api/verification/${c.id}/people`, { body });
    if (!r.ok) return setErr(r.error?.message ?? "Could not add");
    onSaved(r.data);
    setF({ ...f, full_name: "", date_of_birth: "", ownership_pct: "", is_pep: false, pan: "", id_type: "" });
  }
  async function remove(pid: string) {
    const r = await api(`/api/verification/${c.id}/people/${pid}`, { method: "DELETE" });
    if (r.ok) onSaved(r.data); else setErr(r.error?.message ?? "Could not remove");
  }
  const isBiz = c.kind === "KYB";
  return (
    <Section title={isBiz ? "People" : "Applicant"} hint={isBiz ? `List every beneficial owner with more than ${req(c).ubo_threshold_pct}% ownership or control, the directors/partners, and the authorised signatory. One person can be added in more than one role.` : "Your own details as shown on your ID."}>
      {c.people.length > 0 && (
        <table className="w-full text-[12px] mb-5">
          <thead><tr className="text-left text-[9px] uppercase tracking-widest text-mist"><th className="py-2">Name</th><th>Role</th><th>Ownership</th><th>PAN</th><th>PEP</th><th></th></tr></thead>
          <tbody>{c.people.map((p: any) => (
            <tr key={p.id} className="border-t border-ink/10">
              <td className="py-2">{p.full_name}</td><td>{p.role}</td><td>{p.ownership_pct != null ? `${p.ownership_pct}%` : "—"}</td>
              <td>{p.pan_masked ? <>{p.pan_masked} {p.pan_status && <Chip status={p.pan_status} />}</> : "—"}</td><td>{p.is_pep ? "Yes" : "No"}</td>
              <td className="text-right">{editable && <button className="text-[#9B2C2C] text-[10px] uppercase tracking-widest" onClick={() => remove(p.id)}>Remove</button>}</td>
            </tr>))}</tbody>
        </table>
      )}
      {editable && (
        <div className="grid sm:grid-cols-3 gap-3">
          {roles.length > 1 && (
            <div><label className="label-text">Role</label><select className="input-field" value={f.role} onChange={e => setF({ ...f, role: e.target.value })}>{roles.map(r => <option key={r.role} value={r.role}>{r.label}</option>)}</select></div>
          )}
          <div><label className="label-text">Full name (as on ID)</label><input className="input-field" value={f.full_name} onChange={e => setF({ ...f, full_name: e.target.value })} /></div>
          <div><label className="label-text">Date of birth</label><input className="input-field" type="date" value={f.date_of_birth} onChange={e => setF({ ...f, date_of_birth: e.target.value })} /></div>
          <div><label className="label-text">Nationality</label><select className="input-field" value={f.nationality} onChange={e => setF({ ...f, nationality: e.target.value })}>{COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></div>
          <div><label className="label-text">Lives in</label><select className="input-field" value={f.country_of_residence} onChange={e => setF({ ...f, country_of_residence: e.target.value })}>{COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></div>
          {f.role === "UBO" && <div><label className="label-text">Ownership %</label><input className="input-field" type="number" min={0} max={100} value={f.ownership_pct} onChange={e => setF({ ...f, ownership_pct: e.target.value })} /></div>}
          {c.country === "IN" && <div><label className="label-text">PAN (optional)</label><input className="input-field" value={f.pan} onChange={e => setF({ ...f, pan: e.target.value.toUpperCase() })} maxLength={10} autoComplete="off" /></div>}
          <div><label className="label-text">ID type</label><select className="input-field" value={f.id_type} onChange={e => setF({ ...f, id_type: e.target.value })}><option value="">Select…</option>{(req(c).id_types ?? []).map((t: string) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></div>
          <label className="flex items-center gap-2 text-[12px] text-ink sm:col-span-2 mt-6"><input type="checkbox" checked={f.is_pep} onChange={e => setF({ ...f, is_pep: e.target.checked })} /> Holds or has held a prominent public position, or is a close family member/associate of someone who does</label>
          <div className="sm:col-span-3"><button className="btn-primary disabled:opacity-40" disabled={f.full_name.length < 2} onClick={add}>Add person</button></div>
        </div>
      )}
    </Section>
  );
}

function DocsSection({ c, editable, onSaved, setErr }: SectionProps) {
  const [busy, setBusy] = useState("");
  async function upload(type: string, personId: string | null, file: File | undefined) {
    if (!file) return;
    setErr(""); setBusy(type + (personId ?? ""));
    const fd = new FormData(); fd.set("type", type); if (personId) fd.set("person_id", personId); fd.set("file", file);
    const res = await fetch(`/api/verification/${c.id}/documents`, { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) return setErr(data?.error?.message ?? "Upload failed");
    onSaved(data);
  }
  async function remove(docId: string) {
    const r = await api(`/api/verification/${c.id}/documents/${docId}`, { method: "DELETE" });
    if (r.ok) onSaved(r.data); else setErr(r.error?.message ?? "Could not remove");
  }
  const row = (spec: any, person: any | null) => {
    const docs = c.documents.filter((d: any) => d.type === spec.type && (d.person_id ?? null) === (person?.id ?? null));
    return (
      <div key={spec.type + (person?.id ?? "")} className="border-t border-ink/10 first:border-0 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[12px] text-ink">{spec.label}{person ? ` — ${person.full_name}` : ""}{spec.required ? " *" : ""}</span>
        </div>
        {docs.map((d: any) => (
          <div key={d.id} className="flex items-center gap-3 mt-2 text-[11px]">
            <a className="text-gold hover:underline" href={`/api/verification/${c.id}/documents/${d.id}`}>{d.filename}</a><span className="text-mist">{Math.round(d.size / 1024)} KB</span><Chip status={d.status} />
            {d.reject_reason && <span className="text-[#9B2C2C]">{d.reject_reason}</span>}
            {editable && d.status !== "ACCEPTED" && <button className="text-[#9B2C2C] text-[10px] uppercase tracking-widest" onClick={() => remove(d.id)}>Remove</button>}
          </div>
        ))}
        {editable && (
          <label className="inline-block mt-2 btn-ghost !py-2 !px-4 cursor-pointer">
            {busy === spec.type + (person?.id ?? "") ? "Uploading…" : docs.length ? "Replace file" : "Choose file"}
            <input type="file" className="hidden" accept="application/pdf,image/png,image/jpeg" onChange={e => { upload(spec.type, person?.id ?? null, e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        )}
      </div>
    );
  };
  return (
    <Section title="Documents" hint="PDF, PNG or JPEG up to 8 MB. Files are encrypted before storage and only you and our review team can open them.">
      {req(c).documents.flatMap((spec: any) => spec.perPerson ? (c.people.length ? c.people.map((p: any) => row(spec, p)) : [<p key={spec.type} className="text-[11px] text-mist py-2">{spec.label}: add people above first.</p>]) : [row(spec, null)])}
    </Section>
  );
}
