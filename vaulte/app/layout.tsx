import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vaulte — cross-border payments through licensed partners",
  description: "A technology platform that routes cross-border payments through licensed partners, shows every cost before you confirm, and never holds your funds.",
  keywords: "cross-border payments, international transfers, invoices, payment links, business payments",
  openGraph: {
    title: "Vaulte — cross-border payments through licensed partners",
    description: "Compare routes, see every cost up front, and pay or get paid across borders. Vaulte never holds your funds.",
    type: "website",
    url: "https://vaulte.io",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Mono:wght@300;400;500&family=Syne:wght@400;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        {process.env.DEMO_MODE === "true" && (
          <div role="note" className="bg-ink text-paper text-center font-mono text-[11px] py-2 px-4">
            SANDBOX: fake money and sample data only. No real payments are made. Do not enter real personal or bank details.
            {process.env.PRODUCTION_URL ? <> The live site is <a className="underline" href={process.env.PRODUCTION_URL}>{process.env.PRODUCTION_URL.replace(/^https?:\/\//, "")}</a>.</> : null}
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
