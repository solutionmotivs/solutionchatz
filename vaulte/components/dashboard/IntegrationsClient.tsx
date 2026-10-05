"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { ErrorBox } from "@/components/auth/AuthShell";
import { Chip, Section, Shell } from "@/components/verification/shared";

const FIELDS: Record<string, Array<[string, string, string]>> = {
  QUICKBOOKS: [["bank", "Bank account id", "QuickBooks account Id of your bank account"], ["charges", "Charges account id", "Expense account for bank/transfer charges"], ["party", "Clearing account id", "A clearing account (not A/R or A/P) for the counterparty side"]],
  ZOHO: [["bank", "Bank account id", "Zoho account_id"], ["charges", "Charges account id", "Zoho account_id of an expense account"], ["party", "Clearing account id", "Zoho account_id of a clearing account"]],
  XERO: [["bank", "Bank account code", "Xero account code"], ["charges", "Charges account code", "Expense account code"], ["party", "Clearing account code", "Clearing account code"]],
  TALLY: [["company", "Tally company name", "Exactly as in Tally"], ["bank", "Bank ledger name", "Existing bank ledger"], ["charges", "Charges ledger name", "Created under Indirect Expenses if missing"]],
};

export default function IntegrationsClient({ canManage }: { canManage: boolean }) {
  const [list, setList] = useState<any[] | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [forms, setForms] = useState<Record<string, Record<string, string>>>({});
  const [hooks, setHooks] = useState<any[]>([]);
  const [dead, setDead] = useState<any[]>([]);
  const [newHook, setNewHook] = useState({ url: "", all: true });
  const [secret, setSecret] = useState("");

  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all([api("/api/integrations"), api("/api/webhooks"), api("/api/webhooks/events?status=failed")]);
    if (a.ok) { setList(a.data.data); setForms(Object.fromEntries(a.data.data.map((p: any) => [p.provider, Object.fromEntries(Object.entries(p.mapping ?? {}).map(([k, v]) => [k, String(v)]))]))); }
    if (b.ok) setHooks(b.data.data);
    if (c.ok) setDead(c.data.data);
  }, []);
  useEffect(() => {
    load();
    const q = new URLSearchParams(window.location.search);
    if (q.get("connected")) setMsg(`${q.get("connected")} connected. Map your accounts below, then sync.`);
    if (q.get("error")) setErr(`Connection failed: ${q.get("error")}`);
  }, [load]);

  async function connect(p: string) {
    setErr("");
    const r = await api(`/api/integrations/${p.toLowerCase()}/connect`, { body: {} });
    if (!r.ok) return setErr(r.error?.message ?? "Failed");
    if (r.data.url) window.location.href = r.data.url; else { setMsg(r.data.next ?? "Connected"); load(); }
  }
  async function save(p: string) {
    setErr(""); setMsg("");
    const f = forms[p] ?? {};
    const r = await api(`/api/integrations/${p.toLowerCase()}/settings`, { method: "PUT", body: { ...f, sync_from: f.sync_from || undefined } });
    if (!r.ok) return setErr(r.error?.message ?? "Failed"); setMsg("Saved"); load();
  }
  async function sync(p: string) {
    setErr(""); setMsg("");
    const r = await api(`/api/integrations/${p.toLowerCase()}/sync`, { body: {} });
    if (!r.ok) return setErr(r.error?.message ?? "Failed");
    setMsg(`${r.data.synced} synced, ${r.data.failed} failed, ${r.data.skipped} skipped (different currency).`); load();
  }
  async function disconnect(p: string) { if (!window.confirm(`Disconnect ${p}?`)) return; await api(`/api/integrations/${p.toLowerCase()}`, { method: "DELETE" }); load(); }
  async function addHook() {
    setErr(""); setSecret("");
    const events = newHook.all ? ["transfer.created", "transfer.funded", "transfer.completed", "transfer.failed", "invoice.paid", "document.received", "ledger.journal.posted", "erp.sync_failed"] : ["transfer.completed"];
    const r = await api("/api/webhooks", { body: { url: newHook.url, events } });
    if (!r.ok) return setErr(r.error?.message ?? "Failed"); setSecret(r.data.secret); setNewHook({ url: "", all: true }); load();
  }
  async function replay(id: string) { await api(`/api/webhooks/events/${id}/replay`, { body: {} }); load(); }

  return (
    <Shell title="Integrations">
      {err && <ErrorBox message={err} />}{msg && <p className="text-[12px] text-[#2D6A4F] mb-4">{msg}</p>}
      <p className="text-[12px] text-slate leading-relaxed max-w-3xl mb-6">Push each completed transfer into your accounting system as one balanced journal (bank, counterparty clearing, charges). Only transfers in your accounting currency are pushed; others are skipped and can be exported as CSV. Vaulte never moves money through these connections.</p>
      {list === null ? <p className="text-[11px] text-mist">Loading…</p> : list.map(p => (
        <Section key={p.provider} title={p.label}>
          <div className="flex flex-wrap items-center gap-3 text-[12px] mb-3">
            <Chip status={p.connected ? "APPROVED" : p.status === "NEEDS_REAUTH" ? "NEEDS_INFO" : "DRAFT"} label={p.status.replace(/_/g, " ")} />
            {p.tenant && <span className="text-mist">{p.tenant}</span>}
            {p.connected && <span className="text-mist">synced {p.synced} · failed {p.failed} · skipped {p.skipped}{p.last_sync_at ? ` · last ${new Date(p.last_sync_at).toLocaleString()}` : ""}</span>}
            {p.last_error && <span className="text-[#9B2C2C]">{p.last_error}</span>}
          </div>
          {!p.available && <p className="text-[11px] text-mist mb-3">Not enabled on this deployment (the operator must register a developer app with {p.label}).</p>}
          {canManage && (
            <div className="flex flex-wrap gap-3 mb-4">
              {(!p.connected) && p.available && <button className="btn-primary" onClick={() => connect(p.provider)}>{p.status === "NEEDS_REAUTH" ? "Reconnect" : "Connect"}</button>}
              {p.connected && p.provider !== "TALLY" && <button className="btn-gold" onClick={() => sync(p.provider)}>Sync now</button>}
              {p.connected && <button className="btn-ghost" onClick={() => disconnect(p.provider)}>Disconnect</button>}
            </div>
          )}
          {p.connected && canManage && (
            <div className="grid sm:grid-cols-2 gap-3">
              {FIELDS[p.provider].map(([k, label, help]) => <div key={k}><label className="label-text">{label}</label><input className="input-field" title={help} placeholder={help} value={forms[p.provider]?.[k] ?? ""} onChange={e => setForms({ ...forms, [p.provider]: { ...(forms[p.provider] ?? {}), [k]: e.target.value } })} /></div>)}
              <div><label className="label-text">Accounting currency</label><input className="input-field" maxLength={3} placeholder="INR" value={forms[p.provider]?.base_currency ?? ""} onChange={e => setForms({ ...forms, [p.provider]: { ...(forms[p.provider] ?? {}), base_currency: e.target.value.toUpperCase() } })} /></div>
              <div><label className="label-text">Sync transfers completed from</label><input className="input-field" type="date" value={forms[p.provider]?.sync_from ?? ""} onChange={e => setForms({ ...forms, [p.provider]: { ...(forms[p.provider] ?? {}), sync_from: e.target.value } })} /></div>
              <div className="sm:col-span-2"><button className="btn-primary" onClick={() => save(p.provider)}>Save mapping</button></div>
            </div>
          )}
          {p.provider === "TALLY" && p.connected && (
            <pre className="mt-4 text-[11px] bg-ink/5 p-3 overflow-x-auto">{`# on the computer that runs Tally (XML server enabled on port 9000)
VAULTE_URL=${typeof window !== "undefined" ? window.location.origin : ""} VAULTE_API_KEY=<your key> node scripts/tally-bridge.mjs`}</pre>
          )}
        </Section>
      ))}

      <Section title="Exports" hint="For any other system or your accountant.">
        <div className="flex flex-wrap gap-4 text-[12px]">
          <a className="text-gold hover:underline" href="/api/exports/transfers?format=csv">Transfers (CSV)</a>
          <a className="text-gold hover:underline" href="/api/exports/vouchers?format=csv">Accounting vouchers (CSV)</a>
          <a className="text-gold hover:underline" href="/api/exports/invoices?format=csv">Invoices (CSV)</a>
          <a className="text-gold hover:underline" href="/api/exports/tally">Tally XML</a>
          <a className="text-gold hover:underline" href="/dashboard/statements">Account statement</a>
        </div>
      </Section>

      <Section title="Webhooks" hint="Signed JSON events. See /api/events/catalogue for every event and how to verify the signature.">
        {hooks.map(h => <div key={h.id} className="flex flex-wrap gap-3 border-t border-ink/10 first:border-0 py-2 text-[12px]"><span>{h.url}</span><span className="text-mist">{h.events.length} events · failures {h.failure_count}</span>{canManage && <button className="text-[#9B2C2C] text-[10px] uppercase tracking-widest" onClick={async () => { await api(`/api/webhooks/${h.id}`, { method: "DELETE" }); load(); }}>Delete</button>}</div>)}
        {canManage && <div className="flex flex-wrap gap-3 mt-4"><input className="input-field flex-1" placeholder="https://your-server.example/vaulte-webhook" value={newHook.url} onChange={e => setNewHook({ ...newHook, url: e.target.value })} /><button className="btn-primary disabled:opacity-40" disabled={!newHook.url} onClick={addHook}>Add endpoint</button></div>}
        {secret && <p className="mt-3 text-[12px]">Signing secret (shown once): <code className="bg-ink/5 px-2 py-1">{secret}</code></p>}
        <h3 className="font-serif text-lg mt-6 mb-2">Failed deliveries</h3>
        {dead.length === 0 ? <p className="text-[12px] text-mist">None. Events are retried 5 times (30 s, 5 min, 30 min, 2 h); after that they appear here for replay.</p> : dead.map(e => <div key={e.id} className="flex flex-wrap gap-3 border-t border-ink/10 first:border-0 py-2 text-[12px]"><span>{e.type}</span><span className="text-mist">{e.endpoint}</span><span className="text-[#9B2C2C]">{e.last_error}</span><button className="text-gold text-[10px] uppercase tracking-widest" onClick={() => replay(e.id)}>Replay</button></div>)}
      </Section>
    </Shell>
  );
}
