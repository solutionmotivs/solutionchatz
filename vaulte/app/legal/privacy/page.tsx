import LegalPage, { H } from "@/components/legal/LegalPage";
import { COMPANY } from "@/lib/legal";

export const dynamic = "force-dynamic";

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>{COMPANY.name} (&quot;Vaulte&quot;) is the data fiduciary / controller of the personal data described here. Contact: {COMPANY.privacyEmail}. This policy is written to meet the requirements of India&apos;s Digital Personal Data Protection Act, 2023 and the EU/UK GDPR; counsel must confirm it for each market served.</p>
      <H>What we collect</H>
      <p><strong>Account:</strong> name, email, phone, job title, password hash, two-factor secret (encrypted), sessions and devices. <strong>Verification (KYC/KYB):</strong> legal names, dates of birth, nationality, addresses, tax and registration numbers (stored encrypted, shown masked), beneficial-owner and director details, identity and address documents (encrypted files), source-of-funds information, screening results. We never collect Aadhaar numbers; if you offer a masked Aadhaar copy as proof, it is stored as a document only. <strong>Transactions:</strong> parties, bank details you provide, amounts, purpose codes, invoices and proforma invoices (including payer names, emails, addresses and tax IDs you enter), payment links and checkout sessions, milestone deals (buyer name, email and country, terms, deliveries, disputes), certificate requests, statements, partner references. <strong>People who pay or approve without an account</strong> (guest payers and deal buyers): the name, email, country and payment details they give us and what they approve or dispute; we process these for the seller and for our own compliance duties. <strong>Technical:</strong> IP address, device and browser details, security logs.</p>
      <H>Why we use it, and on what basis</H>
      <p>To provide the service you asked for; to meet legal obligations (anti-money-laundering, sanctions, tax and exchange-control record keeping, regulator requests); to prevent fraud and protect accounts; and, only where you opt in, for product updates. Under the DPDP Act we rely on your consent and on the legitimate uses the Act permits (including compliance with law).</p>
      <H>Who receives it</H>
      <p>Licensed payment, banking, foreign-exchange, escrow and virtual-asset partners that execute your transactions (for example Airwallex, Currencycloud and Wise where used); identity and sanctions-screening providers, and official registers we query to check identifiers (the EU VIES service, the GLEIF LEI index, UK Companies House, the Australian Business Register, Indian GST and tax verification providers), to which we send only the identifier needed and receive the registered name, address and status; cloud hosting, email delivery and security providers acting on our instructions; auditors and professional advisers; and regulators or law enforcement where the law requires. We do not sell personal data.</p>
      <H>Where it is stored, and transfers abroad</H>
      <p>Primary hosting region: {COMPANY.dataRegion}. Payment data relating to Indian payment systems is stored in India as the Reserve Bank of India&apos;s storage rules require [COUNSEL AND INFRASTRUCTURE TO CONFIRM]. Cross-border transfers to partners and processors are limited to what each transaction needs and are protected by contract.</p>
      <H>How long we keep it</H>
      <p>Account and verification records and transaction records are kept for the period anti-money-laundering, tax and exchange-control laws require after the relationship ends (commonly five years or more) [COUNSEL TO SET PER JURISDICTION], then deleted or anonymised. Security logs are kept for [PERIOD].</p>
      <H>Your rights</H>
      <p>You can ask to access, correct, update or erase your personal data, withdraw consent, nominate a person to exercise your rights, and complain. Erasure is limited where the law requires us to keep records. EU/UK users also have the rights to restrict processing, to portability and to object, and to complain to their supervisory authority. Write to {COMPANY.privacyEmail}; unresolved complaints go to our <a className="text-gold underline" href="/legal/grievance">grievance officer</a>.</p>
      <H>Security</H>
      <p>See our <a className="text-gold underline" href="/legal/security">security overview</a>. We tell affected people and regulators about personal-data breaches as the law requires.</p>
      <H>Cookies</H>
      <p>We use one essential session cookie to keep you signed in (HttpOnly, Secure, SameSite). We do not use advertising or analytics cookies. If that changes, this page and a consent banner will change first.</p>
      <H>Children</H>
      <p>Vaulte is not for anyone under 18.</p>
    </LegalPage>
  );
}
