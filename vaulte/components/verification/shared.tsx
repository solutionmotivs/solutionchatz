"use client";
import Link from "next/link";

export const STATUS_STYLE: Record<string, string> = {
  APPROVED: "text-[#2D6A4F] border-[#2D6A4F]/40", VERIFIED: "text-[#2D6A4F] border-[#2D6A4F]/40", ACCEPTED: "text-[#2D6A4F] border-[#2D6A4F]/40",
  IN_REVIEW: "text-[#8A6D1F] border-gold/60", SUBMITTED: "text-[#8A6D1F] border-gold/60", MANUAL: "text-[#8A6D1F] border-gold/60", UPLOADED: "text-[#8A6D1F] border-gold/60", PENDING: "text-mist border-ink/20",
  NEEDS_INFO: "text-[#9A4B12] border-[#9A4B12]/40", NEEDS_MORE_INFO: "text-[#9A4B12] border-[#9A4B12]/40",
  REJECTED: "text-[#9B2C2C] border-[#9B2C2C]/40", FAILED: "text-[#9B2C2C] border-[#9B2C2C]/40", DRAFT: "text-mist border-ink/20", NOT_STARTED: "text-mist border-ink/20",
};

export function Chip({ status, label }: { status: string; label?: string }) {
  return <span className={`inline-block text-[9px] uppercase tracking-widest border px-2 py-0.5 ${STATUS_STYLE[status] ?? "text-mist border-ink/20"}`}>{(label ?? status).replace(/_/g, " ")}</span>;
}

export function Shell({ title, back, children, right }: { title: string; back?: { href: string; label: string }; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper font-mono">
      <div className="border-b border-ink/10 px-8 py-4 flex items-center justify-between">
        <Link href="/dashboard" className="font-serif text-xl text-ink">Vaulte</Link>
        <div className="flex gap-6 items-center text-[10px] uppercase tracking-widest">{right}<Link href="/dashboard/profile" className="text-mist hover:text-ink">Account</Link></div>
      </div>
      <div className="max-w-5xl mx-auto px-6 py-10">
        {back && <Link href={back.href} className="text-[10px] uppercase tracking-widest text-mist hover:text-ink">← {back.label}</Link>}
        <h1 className="font-serif text-3xl text-ink mt-2 mb-8">{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border border-ink/10 p-6 mb-6">
      <h2 className="font-serif text-xl text-ink">{title}</h2>
      {hint && <p className="text-[11px] text-mist mt-1 mb-4 leading-relaxed">{hint}</p>}
      <div className={hint ? "" : "mt-4"}>{children}</div>
    </section>
  );
}

export const PURPOSE_LABELS: Record<string, string> = {
  EXPORT_SERVICES: "Export of services", EXPORT_GOODS: "Export of goods", IMPORT_GOODS: "Import of goods", IMPORT_SERVICES: "Import of services",
  MARKETPLACE_PAYOUTS: "Marketplace payouts", FAMILY_MAINTENANCE: "Family support or gifts", LRS_OUTWARD: "Remittance abroad (LRS)",
  FREELANCE_RECEIPTS: "Freelance income", GIFT_OR_SUPPORT_RECEIVED: "Personal money received",
};
