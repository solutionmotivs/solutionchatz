import LegalPage, { H } from "@/components/legal/LegalPage";

export const dynamic = "force-dynamic";

export default function AcceptableUse() {
  return (
    <LegalPage title="Acceptable Use Policy">
      <p>What you may and may not use Vaulte for. Our licensed partners apply their own, sometimes stricter, rules. We may refuse, hold or reverse any payment and close accounts that breach this policy.</p>
      <H>Not allowed</H>
      <ul className="list-disc pl-5 space-y-2">
        <li>Dealing with sanctioned persons, entities, vessels, wallets or jurisdictions, or helping anyone evade sanctions or exchange controls.</li>
        <li>Money laundering, terrorist financing, fraud, scams, pyramid or Ponzi schemes, advance-fee schemes, or collecting money for goods or services you do not supply.</li>
        <li>Operating a money-transfer, payment, crypto-exchange, custody or escrow business for others through Vaulte without the licences your countries require.</li>
        <li>Illegal goods and services; weapons and ammunition; controlled drugs; counterfeit goods; stolen data or credentials; hacking tools used to harm others; human trafficking; child sexual abuse material.</li>
        <li>Gambling, betting and lotteries; adult content; and unlicensed investment, trading, forex or &quot;high-yield&quot; schemes.</li>
        <li>Splitting or disguising payments to avoid limits, reviews or reporting; using someone else&apos;s identity; giving false invoices, purpose codes or documents.</li>
        <li>Using payment links, invoices or milestone deals for payments that do not match your declared business, or for round-trip or circular payments.</li>
      </ul>
      <H>Needs prior approval</H>
      <p>Businesses in higher-risk fields (for example virtual-asset services, money services, charities in conflict regions, cannabis-derived products where lawful, precious metals, and marketplaces collecting money for third parties) must tell us before using Vaulte and may be declined, limited or put on enhanced due diligence.</p>
      <H>Accurate information</H>
      <p>Everything you give us (identity, ownership, purpose, volumes, documents, invoice details) must be true and kept up to date. Tell us about changes.</p>
      <H>Security</H>
      <p>Do not probe, attack or overload the platform, share credentials, or let others use your account or API keys. Report vulnerabilities through the contact on our security page.</p>
      <H>Reports</H>
      <p>If you see misuse, tell us via the <a className="text-gold underline" href="/legal/grievance">grievance officer page</a>.</p>
    </LegalPage>
  );
}
