"use client";
import Link from "next/link";

interface Stat { label: string; value: string }
interface Rail { name: string; speed: string; cost: string; best: string }
interface FAQ { q: string; a: string }

interface CorridorPageProps {
  from: string; to: string;
  fromFlag: string; toFlag: string;
  fromCurrency: string; toCurrency: string;
  headline: string; subheadline: string;
  stats: Stat[];
  rails: Rail[];
  faq: FAQ[];
  metaTitle: string;
  metaDescription: string;
}

export default function CorridorPage(props: CorridorPageProps) {
  const { from, to, fromFlag, toFlag, fromCurrency, toCurrency,
    headline, subheadline, stats, rails, faq } = props;

  return (
    <div className="min-h-screen bg-paper font-mono">
      {/* Nav */}
      <nav className="border-b border-ink/10 px-8 py-4 flex items-center justify-between">
        <Link href="/" className="font-serif text-xl text-ink">Vaulte</Link>
        <div className="flex items-center gap-4">
          <Link href="/corridors/swift-alternative" className="text-[10px] text-mist hover:text-ink uppercase tracking-widest hidden md:block">SWIFT Alternative</Link>
          <Link href="/corridors/b2b-payment-api" className="text-[10px] text-mist hover:text-ink uppercase tracking-widest hidden md:block">API Docs</Link>
          <Link href="/register" className="btn-primary text-[10px]">Try the Sandbox →</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-8 py-20 max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <span className="text-3xl">{fromFlag}</span>
          <div className="flex-1 h-px border-t border-dashed border-ink/20" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-gold px-3 py-1 border border-gold/30">Vaulte Route</span>
          <div className="flex-1 h-px border-t border-dashed border-ink/20" />
          <span className="text-3xl">{toFlag}</span>
        </div>

        <h1 className="font-serif text-5xl md:text-6xl leading-tight tracking-tight text-ink mb-6">
          {headline}
        </h1>
        <p className="text-[13px] leading-[1.85] text-slate max-w-[600px] mb-10">
          {subheadline}
        </p>

        <div className="flex gap-4 mb-16">
          <Link href="/register" className="btn-gold">Try the Sandbox</Link>
          <Link href="/login" className="btn-ghost">Sign In</Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 border border-ink/10">
          {stats.map(s => (
            <div key={s.label} className="p-6 border-r border-ink/10 last:border-r-0">
              <div className="font-serif text-3xl text-ink mb-1">{s.value}</div>
              <div className="text-[9px] uppercase tracking-[0.1em] text-mist">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Comparison table */}
      <section className="bg-cream border-y border-ink/10 px-8 py-16">
        <div className="max-w-5xl mx-auto">
          <div className="text-[10px] uppercase tracking-[0.12em] text-mist mb-6 flex items-center gap-3">
            <span className="w-4 h-px bg-mist inline-block" />
            {from} → {to} — how it compares
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-ink/10">
                  {["Method", "Speed", "Fee", "Best for"].map(h => (
                    <th key={h} className="text-left py-3 pr-6 text-[9px] uppercase tracking-widest text-mist font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rails.map((r, i) => (
                  <tr key={r.name} className={`border-b border-ink/5 ${i === 0 ? "bg-gold/5" : ""}`}>
                    <td className="py-4 pr-6 font-medium text-ink flex items-center gap-2">
                      {i === 0 && <span className="text-[8px] bg-gold text-ink px-1.5 py-0.5 uppercase tracking-widest">Best</span>}
                      {r.name}
                    </td>
                    <td className="py-4 pr-6 text-v-green-light">{r.speed}</td>
                    <td className="py-4 pr-6 text-slate">{r.cost}</td>
                    <td className="py-4 text-mist">{r.best}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-8 py-16 max-w-5xl mx-auto">
        <div className="text-[10px] uppercase tracking-[0.12em] text-mist mb-10 flex items-center gap-3">
          <span className="w-4 h-px bg-mist inline-block" />How it works
        </div>
        <div className="grid grid-cols-4 gap-8">
          {[
            { n: "1", title: "Register", desc: `Create a free sandbox account. No card needed.` },
            { n: "2", title: "Add parties", desc: `Add the ${from} sender and the ${to} recipient. Our licensed partners verify them before live payments.` },
            { n: "3", title: "Get a quote", desc: `See the route, arrival estimate and every fee for ${fromCurrency}→${toCurrency}. The price is firm for a few minutes.` },
            { n: "4", title: "Pay and track", desc: `Pay the partner. Track status by webhook and get your documents when the recipient is paid.` },
          ].map(step => (
            <div key={step.n} className="relative">
              <div className="font-serif text-5xl text-ink/6 mb-4">{step.n}</div>
              <div className="font-display font-bold text-sm text-ink mb-2">{step.title}</div>
              <div className="text-[11px] leading-[1.75] text-mist">{step.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Code snippet */}
      <section className="bg-ink px-8 py-16">
        <div className="max-w-5xl mx-auto">
          <div className="text-[10px] uppercase tracking-[0.12em] text-white/30 mb-8 flex items-center gap-3">
            <span className="w-4 h-px bg-white/20 inline-block" />
            One API call for {from} → {to}
          </div>
          <div className="grid grid-cols-2 gap-8">
            <div>
              <h2 className="font-serif text-3xl text-paper mb-4 leading-snug">
                A simple API.<br/><span className="text-gold">Quote first</span>, then pay.
              </h2>
              <p className="text-[12px] leading-[1.8] text-white/40 mb-6">
                RESTful JSON API with idempotency keys, signed webhooks and a sandbox that behaves like production.
              </p>
              <Link href="/register" className="btn-gold inline-block">Get a Sandbox API Key</Link>
            </div>
            <pre className="bg-white/4 border border-white/8 p-5 text-[11px] leading-[1.8] text-white/70 overflow-auto rounded-[1px]">
{`# 1) Get a firm quote
curl -X POST https://app.vaulte.io/api/quotes \\
  -H "Authorization: Bearer vlt_test_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "kind": "BUSINESS",
    "sender_entity_id": "ENT_SENDER",
    "recipient_entity_id": "ENT_RECIPIENT",
    "source_currency": "${fromCurrency}",
    "dest_currency": "${toCurrency}",
    "source_amount": 500000,
    "funding_method": "FIAT_LOCAL"
  }'

# 2) Create the transfer from the quote
curl -X POST https://app.vaulte.io/api/stablecoin/payins \\
  -H "Authorization: Bearer vlt_test_..." \\
  -d '{ "quote_id": "QUOTE_ID", "invoice_id": "INV_ID" }'`}
            </pre>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-8 py-16 max-w-5xl mx-auto">
        <div className="text-[10px] uppercase tracking-[0.12em] text-mist mb-10 flex items-center gap-3">
          <span className="w-4 h-px bg-mist inline-block" />Frequently Asked
        </div>
        <div className="divide-y divide-ink/8">
          {faq.map(item => (
            <details key={item.q} className="py-5 group">
              <summary className="font-display font-bold text-sm text-ink cursor-pointer list-none flex items-center justify-between">
                {item.q}
                <span className="text-mist group-open:rotate-180 transition-transform">↓</span>
              </summary>
              <p className="mt-3 text-[12px] leading-[1.85] text-slate">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-ink px-8 py-20 text-center">
        <h2 className="font-serif text-4xl text-paper mb-4">
          Start moving money<br/><span className="text-gold">{from} → {to}</span> today.
        </h2>
        <p className="text-[12px] text-white/40 mb-8 max-w-md mx-auto">
          Free sandbox account. Live payments unlock after verification by our licensed partners.
        </p>
        <Link href="/register" className="btn-gold inline-block text-[11px]">
          Create Free Account →
        </Link>
        <p className="mt-4 text-[10px] text-white/25">
          Vaulte is a technology platform · Funds are held by licensed partners · Availability varies by country
        </p>
      </section>

      {/* Footer */}
      <footer className="border-t border-ink/10 px-8 py-8 flex items-center justify-between text-[10px] text-mist">
        <div className="flex gap-6">
          <Link href="/" className="hover:text-ink">Home</Link>
          <Link href="/corridors/swift-alternative" className="hover:text-ink">SWIFT Alternative</Link>
          <Link href="/corridors/b2b-payment-api" className="hover:text-ink">API</Link>
          <Link href="/register" className="hover:text-ink">Register</Link>
        </div>
        <span>© 2026 Vaulte · Not a bank. Services provided by licensed partners.</span>
      </footer>
    </div>
  );
}
