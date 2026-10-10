import Link from "next/link";

export const metadata = { title: "Pay ID not found", robots: { index: false } };

export default function PayIdNotFound() {
  return (
    <main className="min-h-screen bg-paper px-6 py-16 font-mono">
      <div className="max-w-xl mx-auto">
        <Link href="/" className="text-[10px] uppercase tracking-widest text-mist">← Vaulte</Link>
        <h1 className="font-serif text-3xl text-ink mt-6">No active Pay ID</h1>
        <p className="text-[12px] text-slate mt-3">This address does not exist or has been switched off. Ask the person you are paying to check it.</p>
      </div>
    </main>
  );
}
