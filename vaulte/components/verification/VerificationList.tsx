"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/client-api";
import { ErrorBox } from "@/components/auth/AuthShell";
import { Chip, PURPOSE_LABELS, Section, Shell } from "./shared";

const KYB_PURPOSES = ["EXPORT_SERVICES", "EXPORT_GOODS", "IMPORT_GOODS", "IMPORT_SERVICES", "MARKETPLACE_PAYOUTS"];
const KYC_PURPOSES = ["FAMILY_MAINTENANCE", "LRS_OUTWARD", "FREELANCE_RECEIPTS", "GIFT_OR_SUPPORT_RECEIVED"];

interface Entity { id: string; legalName: string; country: string; entityType: string; verificationStatus: string }

export default function VerificationList({ role, accountType, country, orgName, entities }: { role: string; accountType: string; country: string; orgName: string; entities: Entity[] }) {
  const router = useRouter();
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [target, setTarget] = useState<string>("ORG");
  const [err, setErr] = useState("");
  const canEdit = role === "OWNER" || role === "ADMIN";

  const [preview, setPreview] = useState<any>(null);
  useEffect(() => { api("/api/verification").then(r => { if (r.ok) setCases(r.data.data); setLoading(false); }); }, []);

  const targetEntity = entities.find(e => e.id === target);
  const kind = target === "ORG" ? (accountType === "INDIVIDUAL" ? "KYC" : "KYB") : targetEntity?.entityType === "INDIVIDUAL" ? "KYC" : "KYB";
  const purposeList = kind === "KYB" ? KYB_PURPOSES : KYC_PURPOSES;

  const subjectCountry = target === "ORG" ? country : targetEntity?.country ?? country;
  useEffect(() => {
    if (!picked.length) { setPreview(null); return; }
    let live = true;
    api(`/api/verification/requirements?kind=${kind}&country=${subjectCountry}&purposes=${picked.join(",")}`).then(r => { if (live) setPreview(r.ok ? r.data : null); });
    return () => { live = false; };
  }, [picked, kind, subjectCountry]);

  async function start() {
    setErr("");
    const r = await api("/api/verification", { body: { purposes: picked, ...(target !== "ORG" ? { entity_id: target } : {}) } });
    if (!r.ok) return setErr(r.error?.message ?? "Could not start");
    router.push(`/dashboard/verification/${r.data.id}`);
  }

  return (
    <Shell title="Verification">
      <p className="text-[12px] text-slate leading-relaxed max-w-2xl mb-8">
        Verification is required before live payments. It follows the rules of your country and the purposes you choose. Our licensed partners may repeat some checks.
        Never share an Aadhaar number, passwords or one-time codes here.
      </p>

      <Section title="Your cases">
        {loading ? <p className="text-[11px] text-mist">Loading…</p> : cases.length === 0 ? <p className="text-[11px] text-mist">No verifications yet. Start one below.</p> : (
          <table className="w-full text-[12px]">
            <thead><tr className="text-left text-[9px] uppercase tracking-widest text-mist"><th className="py-2">Subject</th><th>Type</th><th>Country</th><th>Status</th><th>Level</th><th></th></tr></thead>
            <tbody>
              {cases.map(c => (
                <tr key={c.id} className="border-t border-ink/10">
                  <td className="py-3">{c.subject_name ?? orgName}</td><td>{c.kind}</td><td>{c.country}</td><td><Chip status={c.status} /></td><td>{c.tier ?? "—"}</td>
                  <td className="text-right"><Link className="text-gold hover:underline" href={`/dashboard/verification/${c.id}`}>Open →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {canEdit ? (
        <Section title="Start or continue a verification" hint="Choose who is being verified and why. You can add or change purposes only by starting a new case.">
          <label className="label-text">Who</label>
          <select className="input-field mb-4" value={target} onChange={e => { setTarget(e.target.value); setPicked([]); }}>
            <option value="ORG">My own account — {orgName} ({country})</option>
            {entities.map(e => <option key={e.id} value={e.id}>{e.legalName} ({e.country}, {e.entityType.toLowerCase()}) — {e.verificationStatus.replace(/_/g, " ").toLowerCase()}</option>)}
          </select>
          <label className="label-text">Purposes</label>
          <div className="grid sm:grid-cols-2 gap-2 mb-5">
            {purposeList.map(p => (
              <label key={p} className="flex items-center gap-2 text-[12px] text-ink border border-ink/10 px-3 py-2 cursor-pointer">
                <input type="checkbox" checked={picked.includes(p)} onChange={e => setPicked(e.target.checked ? [...picked, p] : picked.filter(x => x !== p))} />
                {PURPOSE_LABELS[p]}
              </label>
            ))}
          </div>
          {preview && (
            <div className="border border-ink/10 px-4 py-3 mb-5 text-[12px] text-ink leading-relaxed">
              <div className="font-serif text-lg mb-1">What you will need for {subjectCountry}</div>
              <div className="text-[10px] uppercase tracking-widest text-mist mt-2">Numbers</div>
              <ul className="list-disc pl-5">{preview.items.filter((i: any) => i.required).map((i: any) => <li key={i.code}>{i.label}</li>)}</ul>
              <div className="text-[10px] uppercase tracking-widest text-mist mt-2">Documents</div>
              <ul className="list-disc pl-5">{preview.documents.filter((d: any) => d.required).map((d: any) => <li key={d.type}>{d.label}</li>)}</ul>
              {preview.people.length > 0 && <p className="mt-2">People: {preview.people.map((p: any) => p.label.toLowerCase()).join(", ")} (owners above {preview.ubo_threshold_pct}%).</p>}
              {preview.registry_info && <p className="text-[11px] text-slate mt-2">Checked against: {preview.registry_info.name}</p>}
            </div>
          )}
          {err && <ErrorBox message={err} />}
          <button className="btn-primary disabled:opacity-40" disabled={!picked.length} onClick={start}>Start {kind === "KYB" ? "business" : "identity"} verification →</button>
        </Section>
      ) : <p className="text-[11px] text-mist">Only owners and admins can start or edit a verification.</p>}
    </Shell>
  );
}
