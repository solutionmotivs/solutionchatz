"use client";
import { useState } from "react";
import { api } from "@/lib/client-api";

/** Shown when the Terms/Privacy/AML texts changed since the user last accepted them. */
export default function TermsBanner({ version, accepted }: { version: string; accepted: string | null }) {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (done) return null;
  return (
    <div role="alert" className="bg-gold/10 border-b border-gold/40 px-6 py-3 font-mono text-[11px] text-ink flex flex-wrap items-center gap-4">
      <span>Our <a className="text-gold underline" href="/legal/terms">Terms</a>, <a className="text-gold underline" href="/legal/privacy">Privacy Policy</a> and <a className="text-gold underline" href="/legal/aml">AML Policy</a> changed (version {version}{accepted ? `; you accepted ${accepted}` : ""}). Please read and accept them to keep using Vaulte.</span>
      <button className="btn-primary !py-2 !px-4 disabled:opacity-40" disabled={busy} onClick={async () => { setBusy(true); const r = await api("/api/auth/terms", { body: {} }); setBusy(false); if (r.ok) setDone(true); }}>I accept</button>
    </div>
  );
}
