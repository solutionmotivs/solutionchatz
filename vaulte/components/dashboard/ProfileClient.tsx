"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { ErrorBox } from "@/components/auth/AuthShell";
import { COUNTRIES } from "@/lib/countries";

type Tab = "profile" | "security" | "sessions" | "keys" | "team";
const TABS: Array<[Tab, string]> = [["profile", "Profile"], ["security", "Security"], ["sessions", "Devices"], ["keys", "API keys"], ["team", "Team"]];

export default function ProfileClient({ role, isStaff }: { role: string; isStaff: boolean }) {
  const [tab, setTab] = useState<Tab>("profile");
  const router = useRouter();
  async function logout() {
    await api("/api/auth/logout", { method: "POST", body: {} });
    router.push("/login");
    router.refresh();
  }
  return (
    <div className="min-h-screen bg-paper font-mono">
      <div className="border-b border-ink/10 px-8 py-4 flex items-center justify-between">
        <Link href="/dashboard" className="font-serif text-xl text-ink">Vaulte</Link>
        <div className="flex gap-6 items-center text-[10px] uppercase tracking-widest">
          <Link href="/dashboard" className="text-mist hover:text-ink">Dashboard</Link>
          {isStaff && <Link href="/admin" className="text-mist hover:text-ink">Staff</Link>}
          <button onClick={logout} className="text-mist hover:text-ink">Sign out</button>
        </div>
      </div>
      <div className="max-w-4xl mx-auto px-6 py-10">
        <h1 className="font-serif text-3xl text-ink mb-6">Account</h1>
        <div className="flex gap-1 border-b border-ink/10 mb-8 overflow-x-auto">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`px-4 py-3 text-[11px] uppercase tracking-widest whitespace-nowrap ${tab === id ? "text-ink border-b-2 border-gold" : "text-mist hover:text-ink"}`}>{label}</button>
          ))}
        </div>
        {tab === "profile" && <ProfileTab />}
        {tab === "security" && <SecurityTab isStaff={isStaff} />}
        {tab === "sessions" && <SessionsTab />}
        {tab === "keys" && <KeysTab role={role} />}
        {tab === "team" && <TeamTab role={role} />}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="border border-ink/10 p-6 mb-6"><h2 className="font-serif text-xl text-ink mb-4">{title}</h2>{children}</section>;
}

function ProfileTab() {
  const [p, setP] = useState<any>(null);
  const [form, setForm] = useState({ name: "", phone: "", job_title: "", timezone: "UTC", marketing_opt_in: false });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [emailForm, setEmailForm] = useState({ new_email: "", password: "", code: "", sent: false });
  const [emailMsg, setEmailMsg] = useState("");
  const load = useCallback(async () => {
    const r = await api("/api/profile");
    if (r.ok) { setP(r.data); setForm({ name: r.data.name, phone: r.data.phone ?? "", job_title: r.data.job_title ?? "", timezone: r.data.timezone, marketing_opt_in: r.data.marketing_opt_in }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!p) return <p className="text-mist text-xs">Loading…</p>;

  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    const r = await api("/api/profile", { method: "PATCH", body: { name: form.name, phone: form.phone || null, job_title: form.job_title || null, timezone: form.timezone, marketing_opt_in: form.marketing_opt_in } });
    if (r.ok) { setMsg("Saved."); load(); } else setErr(r.error?.message ?? "Could not save");
  }
  async function requestEmail(e: React.FormEvent) {
    e.preventDefault(); setEmailMsg("");
    const r = await api("/api/profile/email/request", { body: { new_email: emailForm.new_email, password: emailForm.password } });
    if (r.ok) { setEmailForm(f => ({ ...f, sent: true })); setEmailMsg(r.data.dev_code ? `Dev mode: your code is ${r.data.dev_code}` : "Code sent to the new address."); } else setEmailMsg(r.error?.message ?? "Failed");
  }
  async function confirmEmail(e: React.FormEvent) {
    e.preventDefault();
    const r = await api("/api/profile/email/confirm", { body: { new_email: emailForm.new_email, code: emailForm.code } });
    if (r.ok) { setEmailMsg("Email updated."); setEmailForm({ new_email: "", password: "", code: "", sent: false }); load(); } else setEmailMsg(r.error?.message ?? "Failed");
  }
  return (
    <>
      <Section title="Profile">
        <form onSubmit={save} className="grid grid-cols-2 gap-4">
          <div><label className="label-text">Full name</label><input className="input-field" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
          <div><label className="label-text">Job title</label><input className="input-field" value={form.job_title} onChange={e => setForm({ ...form, job_title: e.target.value })} /></div>
          <div><label className="label-text">Phone</label><input className="input-field" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" /></div>
          <div><label className="label-text">Time zone</label><input className="input-field" value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })} /></div>
          <label className="col-span-2 flex gap-3 text-[11px] text-slate"><input type="checkbox" checked={form.marketing_opt_in} onChange={e => setForm({ ...form, marketing_opt_in: e.target.checked })} />Send me product updates</label>
          <div className="col-span-2 flex items-center gap-4"><button className="btn-primary">Save</button>{msg && <span className="text-[11px] text-v-green">{msg}</span>}</div>
          <div className="col-span-2"><ErrorBox message={err} /></div>
        </form>
      </Section>
      <Section title="Account details">
        <table className="w-full text-[12px]"><tbody>
          {[["Email", `${p.email}${p.email_verified ? " (verified)" : ""}`], ["Role", p.role], ["Organization", p.organization.name], ["Account type", p.organization.account_type === "INDIVIDUAL" ? "Individual (KYC)" : "Business (KYB)"], ["Country", COUNTRIES.find(([c]) => c === p.organization.country)?.[1] ?? p.organization.country], ["Verification", p.organization.kyb_status.replace(/_/g, " ")], ["Last sign-in", p.last_login_at ? new Date(p.last_login_at).toLocaleString() : "—"]].map(([k, v]) => (
            <tr key={k} className="border-b border-ink/5"><td className="py-2 text-mist w-1/3">{k}</td><td className="py-2 text-ink">{v}</td></tr>
          ))}
        </tbody></table>
      </Section>
      <Section title="Change email">
        {!emailForm.sent ? (
          <form onSubmit={requestEmail} className="grid grid-cols-2 gap-4">
            <div><label className="label-text">New email</label><input type="email" className="input-field" value={emailForm.new_email} onChange={e => setEmailForm({ ...emailForm, new_email: e.target.value })} required /></div>
            <div><label className="label-text">Current password</label><input type="password" className="input-field" value={emailForm.password} onChange={e => setEmailForm({ ...emailForm, password: e.target.value })} required /></div>
            <div className="col-span-2"><button className="btn-ghost">Send code to new address</button></div>
          </form>
        ) : (
          <form onSubmit={confirmEmail} className="flex gap-4 items-end">
            <div className="flex-1"><label className="label-text">6-digit code</label><input className="input-field" value={emailForm.code} onChange={e => setEmailForm({ ...emailForm, code: e.target.value.replace(/\D/g, "").slice(0, 6) })} /></div>
            <button className="btn-primary">Confirm</button>
          </form>
        )}
        {emailMsg && <p className="text-[11px] text-gold mt-3">{emailMsg}</p>}
      </Section>
    </>
  );
}

function SecurityTab({ isStaff }: { isStaff: boolean }) {
  const [me, setMe] = useState<any>(null);
  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const [pwMsg, setPwMsg] = useState("");
  const [setup, setSetup] = useState<any>(null);
  const [setupPw, setSetupPw] = useState("");
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [msg, setMsg] = useState("");
  const [disable, setDisable] = useState({ password: "", code: "" });
  const load = useCallback(async () => { const r = await api("/api/auth/me"); if (r.ok) setMe(r.data); }, []);
  useEffect(() => { load(); }, [load]);
  if (!me) return <p className="text-mist text-xs">Loading…</p>;

  async function changePw(e: React.FormEvent) {
    e.preventDefault();
    const r = await api("/api/auth/password/change", { body: pw });
    setPwMsg(r.ok ? "Password changed. Other devices were signed out." : r.error?.message ?? "Failed");
    if (r.ok) setPw({ current_password: "", new_password: "" });
  }
  async function start(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    const r = await api("/api/auth/2fa/setup", { body: { password: setupPw } });
    if (r.ok) setSetup(r.data); else setMsg(r.error?.message ?? "Failed");
  }
  async function enable(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    const r = await api("/api/auth/2fa/enable", { body: { code } });
    if (r.ok) { setCodes(r.data.recovery_codes); setSetup(null); load(); } else setMsg(r.error?.message ?? "Failed");
  }
  async function off(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    const r = await api("/api/auth/2fa/disable", { body: disable });
    if (r.ok) { setDisable({ password: "", code: "" }); load(); } else setMsg(r.error?.message ?? "Failed");
  }
  return (
    <>
      <Section title="Two-factor authentication">
        <p className="text-[12px] text-slate mb-4">Use an authenticator app (Google Authenticator, 1Password, Authy). {isStaff ? "Required for staff." : "Strongly recommended."}</p>
        {codes && (
          <div className="border border-gold/40 bg-gold/5 p-4 mb-4">
            <p className="text-[11px] text-ink mb-2">Save these recovery codes now. Each works once. They are not shown again.</p>
            <div className="grid grid-cols-2 gap-1 text-[12px]">{codes.map(c => <code key={c}>{c}</code>)}</div>
          </div>
        )}
        {me.mfa_enabled ? (
          <form onSubmit={off} className="grid grid-cols-3 gap-3 items-end">
            <div className="text-[12px] text-v-green col-span-3">Enabled.</div>
            {!isStaff && (<>
              <div><label className="label-text">Password</label><input type="password" className="input-field" value={disable.password} onChange={e => setDisable({ ...disable, password: e.target.value })} required /></div>
              <div><label className="label-text">Authenticator code</label><input className="input-field" value={disable.code} onChange={e => setDisable({ ...disable, code: e.target.value.replace(/\D/g, "").slice(0, 6) })} required /></div>
              <button className="btn-ghost">Turn off</button>
            </>)}
          </form>
        ) : setup ? (
          <form onSubmit={enable} className="flex gap-6 items-start">
            <img src={setup.qr_data_url} alt="Scan with your authenticator app" className="w-[160px] h-[160px] border border-ink/10" />
            <div className="flex-1 space-y-3">
              <p className="text-[11px] text-slate">Scan the QR code, or enter this key manually:</p>
              <code className="block text-[12px] break-all select-all">{setup.secret}</code>
              <div><label className="label-text">Code from the app</label><input className="input-field" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} required /></div>
              <button className="btn-primary">Turn on</button>
            </div>
          </form>
        ) : (
          <form onSubmit={start} className="flex gap-4 items-end">
            <div className="flex-1"><label className="label-text">Confirm your password</label><input type="password" className="input-field" value={setupPw} onChange={e => setSetupPw(e.target.value)} required /></div>
            <button className="btn-primary">Set up</button>
          </form>
        )}
        <div className="mt-3"><ErrorBox message={msg} /></div>
      </Section>
      <Section title="Change password">
        <form onSubmit={changePw} className="grid grid-cols-2 gap-4">
          <div><label className="label-text">Current password</label><input type="password" className="input-field" value={pw.current_password} onChange={e => setPw({ ...pw, current_password: e.target.value })} required /></div>
          <div><label className="label-text">New password</label><input type="password" className="input-field" value={pw.new_password} onChange={e => setPw({ ...pw, new_password: e.target.value })} required minLength={10} /></div>
          <div className="col-span-2 flex gap-4 items-center"><button className="btn-primary">Change password</button>{pwMsg && <span className="text-[11px] text-gold">{pwMsg}</span>}</div>
        </form>
      </Section>
    </>
  );
}

function SessionsTab() {
  const [rows, setRows] = useState<any[]>([]);
  const load = useCallback(async () => { const r = await api("/api/auth/sessions"); if (r.ok) setRows(r.data.data); }, []);
  useEffect(() => { load(); }, [load]);
  async function revoke(id: string) { await api(`/api/auth/sessions/${id}`, { method: "DELETE" }); load(); }
  return (
    <Section title="Signed-in devices">
      <table className="w-full text-[12px]"><thead><tr className="text-left text-mist text-[10px] uppercase tracking-widest"><th className="py-2">Device</th><th>IP</th><th>Last active</th><th /></tr></thead><tbody>
        {rows.map(s => (
          <tr key={s.id} className="border-t border-ink/5"><td className="py-3 text-ink">{s.device}{s.current && <span className="ml-2 text-v-green text-[10px]">this device</span>}</td><td className="text-mist">{s.ip}</td><td className="text-mist">{s.last_seen_at ? new Date(s.last_seen_at).toLocaleString() : "—"}</td><td className="text-right">{!s.current && <button className="text-v-red text-[11px]" onClick={() => revoke(s.id)}>Sign out</button>}</td></tr>
        ))}
      </tbody></table>
    </Section>
  );
}

function KeysTab({ role }: { role: string }) {
  const [keys, setKeys] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState("");
  const [err, setErr] = useState("");
  const can = ["OWNER", "ADMIN", "DEVELOPER"].includes(role);
  const load = useCallback(async () => { const r = await api("/api/api-keys"); if (r.ok) setKeys(r.data.data); }, []);
  useEffect(() => { load(); }, [load]);
  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    const r = await api("/api/api-keys", { body: { name } });
    if (r.ok) { setFresh(r.data.key); setName(""); load(); } else setErr(r.error?.message ?? "Failed");
  }
  async function revoke(id: string) { await api(`/api/api-keys/${id}`, { method: "DELETE" }); load(); }
  return (
    <Section title="API keys">
      {fresh && <div className="border border-gold/40 bg-gold/5 p-4 mb-4"><p className="text-[11px] text-ink mb-2">Copy your new key now. It is shown only once.</p><code className="text-[12px] break-all select-all">{fresh}</code></div>}
      {can && (
        <form onSubmit={create} className="flex gap-4 items-end mb-6">
          <div className="flex-1"><label className="label-text">New sandbox key name</label><input className="input-field" value={name} onChange={e => setName(e.target.value)} required minLength={2} placeholder="e.g. ERP sync" /></div>
          <button className="btn-primary">Create</button>
        </form>
      )}
      <ErrorBox message={err} />
      <table className="w-full text-[12px]"><thead><tr className="text-left text-mist text-[10px] uppercase tracking-widest"><th className="py-2">Name</th><th>Key</th><th>Mode</th><th>Last used</th><th /></tr></thead><tbody>
        {keys.map(k => (
          <tr key={k.id} className="border-t border-ink/5"><td className="py-3 text-ink">{k.name}</td><td className="text-mist">{k.prefix}…</td><td>{k.live ? "Live" : "Sandbox"}</td><td className="text-mist">{k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : "never"}</td><td className="text-right">{can && <button className="text-v-red text-[11px]" onClick={() => revoke(k.id)}>Revoke</button>}</td></tr>
        ))}
      </tbody></table>
    </Section>
  );
}

function TeamTab({ role }: { role: string }) {
  const [data, setData] = useState<{ members: any[]; invites: any[] }>({ members: [], invites: [] });
  const [inv, setInv] = useState({ email: "", role: "FINANCE" });
  const [msg, setMsg] = useState("");
  const manage = ["OWNER", "ADMIN"].includes(role);
  const load = useCallback(async () => { const r = await api("/api/team"); if (r.ok) setData(r.data); }, []);
  useEffect(() => { load(); }, [load]);
  async function invite(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    const r = await api("/api/team/invites", { body: inv });
    if (r.ok) { setMsg("Invitation sent."); setInv({ email: "", role: "FINANCE" }); load(); } else setMsg(r.error?.message ?? "Failed");
  }
  async function remove(id: string) { await api(`/api/team/members/${id}`, { method: "DELETE" }); load(); }
  async function cancel(id: string) { await api(`/api/team/invites/${id}`, { method: "DELETE" }); load(); }
  return (
    <>
      {manage && (
        <Section title="Invite a teammate">
          <form onSubmit={invite} className="flex gap-4 items-end">
            <div className="flex-1"><label className="label-text">Email</label><input type="email" className="input-field" value={inv.email} onChange={e => setInv({ ...inv, email: e.target.value })} required /></div>
            <div><label className="label-text">Role</label><select className="input-field" value={inv.role} onChange={e => setInv({ ...inv, role: e.target.value })}>{["ADMIN", "FINANCE", "DEVELOPER", "READ_ONLY"].map(r => <option key={r}>{r}</option>)}</select></div>
            <button className="btn-primary">Invite</button>
          </form>
          {msg && <p className="text-[11px] text-gold mt-3">{msg}</p>}
        </Section>
      )}
      <Section title="Members">
        <table className="w-full text-[12px]"><tbody>
          {data.members.map(m => (
            <tr key={m.id} className="border-b border-ink/5"><td className="py-3 text-ink">{m.name}<div className="text-mist text-[11px]">{m.email}</div></td><td>{m.role}</td><td className="text-mist">{m.status}{m.mfa_enabled ? " · 2FA" : ""}</td><td className="text-right">{manage && m.role !== "OWNER" && m.status === "ACTIVE" && <button className="text-v-red text-[11px]" onClick={() => remove(m.id)}>Remove</button>}</td></tr>
          ))}
        </tbody></table>
        {data.invites.length > 0 && <div className="mt-6"><h3 className="text-[10px] uppercase tracking-widest text-mist mb-2">Pending invitations</h3>
          {data.invites.map(i => <div key={i.id} className="flex justify-between text-[12px] py-2 border-b border-ink/5"><span>{i.email} · {i.role}</span>{manage && <button className="text-v-red text-[11px]" onClick={() => cancel(i.id)}>Cancel</button>}</div>)}</div>}
      </Section>
    </>
  );
}
