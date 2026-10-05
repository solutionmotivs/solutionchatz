import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vaulte — B2B Payment Infrastructure",
  description: "Move money globally without asking permission. Invoice-linked B2B payments on SWIFT, SEPA, ACH, and UPI rails.",
  keywords: "B2B payments, international wire transfer, SWIFT, SEPA, payment gateway, business payments",
  openGraph: {
    title: "Vaulte — B2B Payment Infrastructure",
    description: "The settlement layer for businesses that operate globally.",
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
      <body>{children}</body>
    </html>
  );
}
