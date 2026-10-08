"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { MARKUP_TIERS } from "@/lib/pricing";

const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
const usdShort = (n: number) => (n === Infinity ? "" : n >= 1_000_000 ? `$${n / 1_000_000}M` : n >= 1_000 ? `$${(n / 1_000).toLocaleString("en-US")}K`.replace(".0K", "K") : `$${n}`);
const tierRows = (kind: "BUSINESS" | "PERSONAL") =>
  MARKUP_TIERS[kind].map((t, i, arr) => ({
    label: i === 0 ? `Up to ${usdShort(t.upToUsd)}` : t.upToUsd === Infinity ? `Over ${usdShort(arr[i - 1].upToUsd)}` : `${usdShort(arr[i - 1].upToUsd)} – ${usdShort(t.upToUsd)}`,
    rate: pct(t.bps),
  }));

export default function LandingPage() {
  const cursorRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const mx = useRef(0), my = useRef(0), rx = useRef(0), ry = useRef(0);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      mx.current = e.clientX; my.current = e.clientY;
      if (cursorRef.current) {
        cursorRef.current.style.left = e.clientX + "px";
        cursorRef.current.style.top = e.clientY + "px";
      }
    };
    window.addEventListener("mousemove", handleMove);

    let raf: number;
    const animate = () => {
      rx.current += (mx.current - rx.current) * 0.14;
      ry.current += (my.current - ry.current) * 0.14;
      if (ringRef.current) {
        ringRef.current.style.left = rx.current + "px";
        ringRef.current.style.top = ry.current + "px";
      }
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => { window.removeEventListener("mousemove", handleMove); cancelAnimationFrame(raf); };
  }, []);

  return (
    <>
      {/* Cursor */}
      <div ref={cursorRef} className="fixed w-3 h-3 bg-gold rounded-full pointer-events-none z-[9999] -translate-x-1/2 -translate-y-1/2 transition-transform duration-150" />
      <div ref={ringRef} className="fixed w-9 h-9 border border-gold/50 rounded-full pointer-events-none z-[9998] -translate-x-1/2 -translate-y-1/2" />

      <div className="cursor-none bg-paper min-h-screen">
        {/* Notice bar */}
        <div className="bg-gold text-ink text-center py-2.5 font-mono text-[10px] tracking-widest">
          Vaulte is a technology platform, not a bank. Payments are executed and held by licensed partners. Vaulte never holds your funds.
        </div>

        {/* Nav */}
        <nav className="fixed top-8 left-0 right-0 z-50 flex items-center justify-between px-12 py-5 bg-paper/90 backdrop-blur-md border-b border-ink/8">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 bg-ink rounded-[3px] flex items-center justify-center">
              <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4">
                <rect x="2" y="2" width="5" height="5" fill="#F4F1EB"/>
                <rect x="9" y="2" width="5" height="5" fill="#C9A84C"/>
                <rect x="2" y="9" width="5" height="5" fill="#C9A84C"/>
                <rect x="9" y="9" width="5" height="5" fill="#F4F1EB" opacity="0.4"/>
              </svg>
            </div>
            <span className="font-serif text-xl">Vaulte</span>
          </div>
          <ul className="hidden md:flex gap-8 font-mono text-[10px] tracking-widest uppercase text-mist">
            {[["How it works","#how"],["Rules we follow","#rules"],["Routes","#routes"],["Pricing","#pricing"]].map(([l, h]) => (
              <li key={l}><a href={h} className="hover:text-ink transition-colors">{l}</a></li>
            ))}
          </ul>
          <Link href="/register" className="btn-primary text-[10px]">Get Started</Link>
        </nav>

        {/* Hero */}
        <section className="min-h-screen grid grid-cols-2 pt-20">
          <div className="flex flex-col justify-center px-12 py-20">
            <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-gold mb-8 flex items-center gap-3">
              <span className="w-6 h-px bg-gold" />
              Cross-border payments · USDC · USDT · bank rails
            </div>
            <h1 className="font-serif text-[72px] leading-[0.97] tracking-[-2px] text-ink mb-7">
              Cross-border<br/>payments in<br/><em className="text-rust">hours, not days</em>
            </h1>
            <p className="font-mono text-[13px] leading-[1.85] text-slate max-w-[420px] mb-12">
              We ask every licensed partner for a live price, show you the full cost stack, and pick the route that lands today at the lowest cost.
              For business payments into India you also get the bank certificate (eFIRA/eBRC) attached to your records, and HS-code and purpose-code checks done before the money moves.
              Settlement times are measured on real transfers and published, not promised.
            </p>
            <div className="flex gap-4">
              <Link href="/register" className="btn-primary">Try the Sandbox</Link>
              <Link href="/quote" className="btn-ghost">Compare cost and speed</Link>
              <Link href="/pilot" className="btn-ghost">Join the pilot</Link>
              <Link href="/login" className="btn-ghost">Sign In</Link>
            </div>
            <div className="flex gap-10 mt-16 pt-10 border-t border-ink/10">
              {[["Same day","Target for most routes*"], ["2+ partners","Per corridor, with failover"], ["USDC · USDT","Where the law allows"]].map(([num, label]) => (
                <div key={label}>
                  <div className="font-serif text-3xl text-ink">{num}</div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-mist mt-1">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Illustrative quote */}
          <div className="bg-ink flex items-center justify-center p-10 relative overflow-hidden">
            <div className="absolute inset-0 bg-radial-gradient opacity-20" />
            <div className="w-full max-w-[380px] border border-white/10 bg-white/4 p-7 relative z-10 backdrop-blur-lg">
              <div className="flex justify-between items-center mb-6 pb-5 border-b border-white/8">
                <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/40">Example quote</span>
                <span className="font-mono text-[9px] text-gold">Illustrative, not a live quote</span>
              </div>
              <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-white/35 mb-1">You send</div>
              <div className="font-serif text-[36px] text-white leading-none mb-5">5,000.00 USDC</div>
              <div className="space-y-2 font-mono text-[10px] text-white/60 mb-5">
                {[
                  ["Partner conversion + network fees", "– $9.50"],
                  ["Vaulte markup (0.30%)", "– $15.00"],
                  ["Market rate", "1 USD = 83.42 INR"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-white/6 pb-2"><span>{k}</span><span className="text-white/80">{v}</span></div>
                ))}
              </div>
              <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-white/35 mb-1">Recipient gets in their bank</div>
              <div className="font-serif text-[30px] text-v-green-light leading-none mb-4">≈ ₹4,15,056</div>
              <div className="font-mono text-[9px] text-white/30 leading-relaxed">
                Paid in INR by an RBI-authorised partner, with the bank certificate. The stablecoin leg stays outside India.
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="bg-cream border-y border-ink/10 py-24 px-12">
          <div className="section-tag">How it works</div>
          <h2 className="font-serif text-5xl tracking-tight text-ink mb-4">
            One quote. <em className="text-gold">Licensed partners</em><br/>do the moving.
          </h2>
          <p className="font-mono text-[13px] leading-[1.85] text-slate max-w-[560px] mb-16">
            Vaulte compares routes across several partners, locks a firm price for a few minutes, and tracks the payment until the recipient is paid.
            Partners receive, convert, hold and pay out the money. Vaulte does not.
          </p>
          <div className="grid grid-cols-4 gap-px bg-ink/10 border border-ink/10">
            {[
              ["01", "Get a firm quote", "See the recipient amount, the route, the arrival estimate, and every fee split out: market rate, partner cost, network fee, Vaulte markup."],
              ["02", "Pay the partner", "Send USDC or USDT to a one-time partner address, or pay by local bank transfer (SEPA, Faster Payments, ACH, FedNow, UAE and Singapore rails)."],
              ["03", "Partner converts and pays out", "A licensed partner converts outside the destination country and pays the recipient in local currency, in their bank."],
              ["04", "Get your documents", "Status updates by webhook. India export receipts come with the bank certificate and purpose code."],
            ].map(([num, title, desc]) => (
              <div key={num} className="bg-cream p-10 hover:bg-gold/5 transition-colors">
                <div className="font-serif text-5xl text-ink/6 mb-4">{num}</div>
                <div className="font-display font-bold text-sm text-ink mb-3">{title}</div>
                <div className="font-mono text-[11px] leading-[1.8] text-slate">{desc}</div>
              </div>
            ))}
          </div>
          <p className="font-mono text-[10px] text-mist mt-6">* Timing is a target and depends on the route, the partner, cut-off times and verification. It is not a guarantee.</p>
        </section>

        {/* Rules */}
        <section id="rules" className="bg-paper py-24 px-12">
          <div className="section-tag">Rules we follow</div>
          <h2 className="font-serif text-5xl tracking-tight text-ink mb-4">Built around the rules,<br/><em className="text-gold">not around them.</em></h2>
          <p className="font-mono text-[13px] leading-[1.85] text-slate max-w-[560px] mb-16">
            The product enforces these in code before any money moves. Availability depends on your country, the route and completed verification.
          </p>
          <div className="grid grid-cols-3 gap-px bg-ink/10 border border-ink/10">
            {[
              ["India always receives rupees", "Recipients in India are paid in INR in their bank through an authorised partner. Crypto never reaches an Indian wallet."],
              ["India sends fiat only", "Payments starting in India are sent in rupees and delivered as local currency abroad. Stablecoin funding from India is blocked."],
              ["Invoice and purpose code", "Business payments to India need an invoice and an RBI purpose code (for example P0802 for services)."],
              ["Personal limits", "Personal transfers respect partner and regulatory limits, including per-transfer and yearly caps for inbound family remittances."],
              ["Verification first", "Senders and recipients are verified (KYB for businesses, KYC for individuals) by the licensed partner before payment details are issued."],
              ["Screening", "Sanctions screening on parties and wallet addresses; high-risk cases are held for review."],
            ].map(([title, desc], idx) => (
              <div key={title} className="bg-paper p-10 hover:bg-gold/5 transition-colors">
                <div className="font-serif text-5xl text-ink/6 mb-4">{String(idx + 1).padStart(2, "0")}</div>
                <div className="font-display font-bold text-sm text-ink mb-3">{title}</div>
                <div className="font-mono text-[11px] leading-[1.8] text-slate">{desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Routes */}
        <section id="routes" className="bg-ink py-24 px-12">
          <div className="section-tag" style={{color:"rgba(255,255,255,0.3)"}}>Routes</div>
          <h2 className="font-serif text-5xl text-paper tracking-tight mb-4">
            Several partners.<br/><em className="text-gold">The best route each time.</em>
          </h2>
          <p className="font-mono text-[13px] leading-[1.85] text-white/50 max-w-[560px]">
            Vaulte owns no payment rail. It compares partner routes on cost and speed, fails over to a second partner if one is down, and skips currency conversion when the currencies already match.
          </p>
          <div className="grid grid-cols-4 gap-px bg-white/8 border border-white/8 mt-16">
            {[
              { icon: "🇪🇺", name: "SEPA Instant", desc: "Euro payments in seconds, around the clock, where the partner supports it.", tags: ["EUR","Seconds (typical)"] },
              { icon: "🇬🇧🇺🇸", name: "Faster Payments · FedNow · ACH", desc: "UK and US local rails for the first and last mile.", tags: ["GBP","USD","Minutes to same day"] },
              { icon: "🪙", name: "USDC · USDT", desc: "Stablecoin hop between partners on fast, low-cost networks. USDT is not offered on EU-licensed legs.", tags: ["On-chain","Minutes"] },
              { icon: "🇮🇳", name: "IMPS · UPI · RTGS", desc: "Last mile into Indian bank accounts through RBI-authorised partners.", tags: ["INR","Same day (target)"] },
            ].map(r => (
              <div key={r.name} className="bg-ink p-10 hover:bg-white/4 transition-colors">
                <div className="w-10 h-10 border border-white/15 flex items-center justify-center text-lg mb-6">{r.icon}</div>
                <div className="font-display font-bold text-sm text-paper mb-2">{r.name}</div>
                <div className="font-mono text-[11px] text-white/40 leading-[1.75] mb-5">{r.desc}</div>
                <div className="flex flex-wrap gap-1.5">
                  {r.tags.map(t => <span key={t} className="font-mono text-[8px] uppercase tracking-widest px-2 py-1 bg-white/6 text-white/40">{t}</span>)}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="bg-cream py-24 px-12">
          <div className="section-tag">Pricing</div>
          <h2 className="font-serif text-5xl tracking-tight text-ink mb-4">Transparent pricing.<br/><em className="text-gold">Every fee on the quote.</em></h2>
          <p className="font-mono text-[13px] leading-[1.85] text-slate max-w-[560px]">
            Vaulte charges a markup that falls as your transfer size grows. Partner conversion and network fees are shown separately and change by route.
            The exact total is on every quote before you pay.
          </p>
          <div className="grid grid-cols-2 gap-px bg-ink/10 border border-ink/10 mt-16">
            {([["Business payments", "BUSINESS"], ["Personal transfers", "PERSONAL"]] as const).map(([title, kind]) => (
              <div key={kind} className="p-12 bg-cream">
                <div className="font-mono text-[10px] uppercase tracking-[0.12em] mb-6 text-mist">{title}</div>
                <ul className="space-y-3">
                  {tierRows(kind).map(r => (
                    <li key={r.label} className="font-mono text-[12px] flex justify-between text-slate border-b border-ink/8 pb-3">
                      <span>{r.label}</span><span className="text-ink">{r.rate} markup</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="font-mono text-[10px] text-mist mt-6">Indicative. Final pricing is shown in your quote and may change with partner costs. Taxes may apply.</p>
          <div className="mt-10"><Link href="/register" className="btn-gold">Try the Sandbox</Link></div>
        </section>

        {/* Footer */}
        <footer className="bg-ink px-12 pt-20 pb-10">
          <div className="grid grid-cols-4 gap-12 pb-16 border-b border-white/6 mb-10">
            <div>
              <div className="font-serif text-2xl text-paper mb-4">Vaulte</div>
              <p className="font-mono text-[11px] text-white/30 leading-relaxed max-w-[240px]">
                Cross-border payments through licensed partners. Vaulte is a technology platform and does not hold customer funds.
              </p>
            </div>
            {[
              { title: "Product", links: ["Quotes","Invoice payments","Virtual accounts","Webhooks"] },
              { title: "Developers", links: ["API reference","Sandbox","Webhooks"] },
              { title: "Company", links: ["About","Security","Privacy","Terms"] },
            ].map(col => (
              <div key={col.title}>
                <div className="font-display font-bold text-[10px] uppercase tracking-[0.12em] text-white/50 mb-5">{col.title}</div>
                <ul className="space-y-2.5">
                  {col.links.map(l => <li key={l}><a href="#" className="font-mono text-[11px] text-white/30 hover:text-white/60 transition-colors">{l}</a></li>)}
                </ul>
              </div>
            ))}
          </div>
          <div className="font-mono text-[10px] text-white/30 leading-relaxed max-w-[820px]">
            © 2026 Vaulte. Vaulte is a technology provider and is not a bank, payment institution or crypto-asset service provider.
            Payment services are provided by licensed partners named in your agreement. Availability, limits and timing depend on the
            corridor, amount and completed verification. Not available in all countries.
          </div>
        </footer>
      </div>
    </>
  );
}
