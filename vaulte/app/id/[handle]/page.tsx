import Link from "next/link";
import QRCode from "qrcode";
import { resolvePayId } from "@/lib/pay-address-public";
import { COMPANY } from "@/lib/legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pay ID", robots: { index: false } };
const LABEL: Record<string, string> = { iban: "IBAN", sort_code: "Sort code", account_number: "Account number", routing_number: "Routing number", bsb: "BSB", institution_number: "Institution number", account_holder: "Account holder", bank_name: "Bank", swift_bic: "SWIFT/BIC", bic_swift: "SWIFT/BIC", aba_ach: "ACH routing" };

export default async function PayIdPage({ params }: { params: { handle: string } }) {
  const r = await resolvePayId(params.handle).catch(() => null);
  if (!r) {
    return (
      <main className="min-h-screen bg-paper px-6 py-16 font-mono"><div className="max-w-xl mx-auto"><Link href="/" className="text-[10px] uppercase tracking-widest text-mist">← Vaulte</Link>
        <h1 className="font-serif text-3xl text-ink mt-6">No active Pay ID</h1><p className="text-[12px] text-slate mt-3">This address does not exist or has been switched off. Ask the person you are paying to check it.</p></div></main>
    );
  }
  const url = `${COMPANY.siteUrl.replace(/\/$/, "")}/id/${r.handle}`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 1, width: 160 });
  return (
    <main className="min-h-screen bg-paper px-6 py-14 font-mono">
      <div className="max-w-3xl mx-auto">
        <Link href="/" className="text-[10px] uppercase tracking-widest text-mist hover:text-ink">← Vaulte</Link>
        <div className="flex flex-wrap items-start justify-between gap-6 mt-6">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-mist">Pay</p>
            <h1 className="font-serif text-4xl text-ink">{r.name}</h1>
            <p className="text-[13px] text-gold mt-1">{`${r.handle}@vaulte`}</p>
            <p className="text-[11px] text-slate mt-2">Name verified by Vaulte · {r.country}{r.tagline ? ` · ${r.tagline}` : ""}</p>
          </div>
          <div aria-label={`QR code for ${url}`} className="border border-ink/10 p-2 bg-white" dangerouslySetInnerHTML={{ __html: qr }} />
        </div>
        {r.accounts.some(a => a.simulated) && <div className="mt-6 border border-[#9A4B12]/40 bg-[#9A4B12]/5 px-4 py-3 text-[11px]">Test mode: these details are simulated. Do not send real money.</div>}
        <h2 className="font-serif text-xl text-ink mt-10">How to pay</h2>
        {r.accounts.length === 0 ? <p className="text-[12px] text-slate mt-3">This business has not opened receiving accounts yet.</p> : (
          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            {r.accounts.map(a => (
              <section key={a.currency + a.country} className="border border-ink/10 p-5">
                <h3 className="font-serif text-lg text-ink">{a.currency} <span className="text-[10px] uppercase tracking-widest text-mist">{a.country}</span></h3>
                <dl className="mt-3 space-y-1 text-[12px]">{Object.entries(a.details).map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-mist">{LABEL[k] ?? k.replace(/_/g, " ")}</dt><dd className="text-ink break-all text-right">{v}</dd></div>)}</dl>
              </section>
            ))}
          </div>
        )}
        <p className="text-[11px] text-slate leading-relaxed mt-8">These are bank details issued in the business&apos;s name by a licensed partner. Vaulte does not hold your money. Check that the name above matches who you intend to pay. Send only in a currency listed here.</p>
      </div>
    </main>
  );
}
