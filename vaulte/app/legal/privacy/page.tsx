import Link from "next/link";
import LegalPage, { A, H, Table } from "@/components/legal/LegalPage";
import { COMPANY, REGIONS } from "@/lib/legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Privacy Policy" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" subtitle="How Vaulte collects, uses, shares, stores and protects personal data, and the rights you have in India, the United States, the UAE, Singapore, the European Union and the United Kingdom.">
      <p>This policy applies to the Vaulte website, applications, APIs, invoices, payment links, checkout pages and milestone-deal pages (together, &quot;Vaulte&quot;), operated by <strong>{COMPANY.name}</strong>, {COMPANY.address} (&quot;we&quot;, &quot;us&quot;). We decide why and how the personal data described here is processed, so we are the <em>data fiduciary</em> under India&apos;s Digital Personal Data Protection Act, 2023 (&quot;DPDP Act&quot;), the <em>controller</em> under the GDPR, UK GDPR, UAE and Singapore laws, and the <em>business</em> under US state privacy laws. Privacy contact: <A href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</A>. Grievance Officer and Data Protection Officer contact: {COMPANY.grievanceName}, <A href={`mailto:${COMPANY.grievanceEmail}`}>{COMPANY.grievanceEmail}</A>.</p>
      <p>This page has two parts. <strong>Part A</strong> is the policy that applies to everyone. <strong>Part B</strong> is a notice for each region with the extra rights, legal bases and complaint routes that apply there:</p>
      <ul className="list-disc pl-6 space-y-1">
        {REGIONS.map(r => <li key={r.slug}><Link className="text-gold underline" href={`/legal/privacy/${r.slug}`}>{r.name}</Link> — {r.law}</li>)}
      </ul>

      <H id="a">Part A — Policy for everyone</H>

      <H id="status">1. What Vaulte is, and its current status</H>
      <p>Vaulte is a technology service for cross-border business payments. It collects the information needed to verify customers, instructs payments through independent licensed partners (banks, payment institutions, foreign-exchange, escrow and virtual-asset providers) and keeps records. Partners, not Vaulte, receive, hold, convert and pay out money. Vaulte is currently operating as a pilot in test mode: no real money moves and live payments are enabled country by country only after the legal checks for that country are complete. The data practices below apply from the first day, in test mode and live.</p>

      <H id="collect">2. Personal data we collect</H>
      <Table head={["Category", "Examples", "Where it comes from"]} rows={[
        ["Account and contact", "Name, email address, phone number, job title, company, country, password (stored only as a one-way hash), two-factor secret (stored encrypted), sign-in times, devices and sessions.", "You"],
        ["Identity and business verification (KYC/KYB)", "Legal name, date of birth, nationality, residential or registered address, tax and registration numbers (for example PAN, GSTIN, CIN, EIN, VAT number, UEN, trade-licence number), director, shareholder and beneficial-owner details, identity and address documents, source-of-funds and source-of-wealth information, the result of checks against official registers.", "You; official registers and verification providers"],
        ["Screening results", "Matches or non-matches against sanctions, politically-exposed-person and adverse-media lists; wallet-address risk results; the risk rating we assign and the reasons for it.", "Created by us and our screening providers"],
        ["Transactions", "Sender, recipient and intermediary details, bank account, UPI or IBAN details, wallet addresses you provide, amounts, currencies, purpose codes, HS codes, invoices and proforma invoices (including the payer details you enter), payment links, checkout sessions, milestone deals, certificate requests, statements and partner references.", "You; partners"],
        ["People who pay or approve without an account", "Name, email, country, payment details, approvals and disputes of guest payers and deal buyers.", "That person; the seller who invited them"],
        ["Technical and security", "IP address, browser and device type, request identifiers, security and audit logs, rate-limit counters.", "Automatically"],
        ["Communications", "Messages you send us, complaints, support tickets, your marketing choices.", "You"],
      ]} />
      <p>We do not collect Aadhaar numbers. If you give a masked Aadhaar copy as proof of identity or address, we store it only as a document. We do not use cameras, microphones or precise location. We do not knowingly collect special categories of data such as health, religion or political opinion; if identity verification uses a face match against an ID photo (only where a provider is enabled for your country and you are told first), that biometric template is processed by the provider for the check and is not kept by us.</p>

      <H id="why">3. Why we use personal data</H>
      <Table head={["Purpose", "Examples"]} rows={[
        ["Provide the service you asked for", "Create and secure your account, quote and route payments, issue invoices, links and certificates, send statements, give support."],
        ["Verify who you are and comply with law", "KYC/KYB, sanctions and politically-exposed-person screening, anti-money-laundering monitoring, tax, exchange-control and reporting duties, responses to regulators, courts and law enforcement."],
        ["Prevent fraud and keep the service safe", "Rate limits, account lock-outs, anomaly review, abuse investigations, backups and incident response."],
        ["Run and improve the service", "Fix errors, measure how long settlements take, plan capacity. We use aggregated figures wherever possible."],
        ["Communicate", "Service and security messages. Product news only if you opted in; you can opt out at any time with one click or by writing to us."],
      ]} />
      <p><strong>We do not sell personal data, do not share it for advertising, and do not use it to train advertising or third-party AI models.</strong> We do not make decisions with legal effect on you purely by automated means: sanctions and risk checks can flag or hold a transaction, but a person reviews any decision to refuse, close or restrict (see your rights, below).</p>

      <H id="share">4. Who receives personal data</H>
      <Table head={["Recipient", "Why", "What they get"]} rows={[
        ["Licensed payment, banking, FX, escrow and virtual-asset partners (for example Airwallex, Currencycloud, Wise, and the Indian authorised dealer or payment-aggregator partner for a corridor)", "To open customer accounts, convert and move money, and issue certificates such as eFIRA, FIRC and eBRC. They are the regulated provider of record for the money.", "Verified identity and business details, payment instructions, purpose and invoice details. Partners also act as independent controllers for their own legal duties."],
        ["Identity, registry and screening providers, and official registers (EU VIES, GLEIF, UK Companies House, the Australian Business Register, Indian GST and tax verification services, sanctions list publishers)", "To check that identifiers are real and who they belong to.", "Only the identifier or name needed for the check."],
        ["Infrastructure providers acting on our instructions: hosting, database, object storage, email delivery, security monitoring", "To run the service. They may not use the data for their own purposes.", "Data needed to host, store, deliver or protect. Documents are encrypted before storage."],
        ["Professional advisers, auditors, insurers", "To obtain advice and assurance.", "The minimum needed, under confidentiality."],
        ["Authorities", "Where the law, a court order or a regulator requires.", "What the lawful request covers."],
        ["A buyer or seller on a transaction with you", "To complete invoices, deals and checkouts.", "The details on the document you or they created."],
        ["A successor, if our business is sold or reorganised", "To continue the service.", "Same protections, and we will tell you first."],
      ]} />

      <H id="transfers">5. Where data is stored and international transfers</H>
      <p>Our application database and encrypted document storage are hosted in {COMPANY.dataRegion}. Partners and providers may process data in other countries, including India, Singapore, the United Arab Emirates, the United States, the United Kingdom and the European Economic Area. Where personal data leaves your country we use the mechanism your law allows: for the EU and UK, standard contractual clauses (EU Commission Decision 2021/914) and the UK International Data Transfer Addendum with a transfer risk assessment; for Singapore, contractual protection to the PDPA standard; for the UAE, adequacy, contracts or your consent as the law provides; for India, transfers are permitted to countries the Central Government has not restricted under section 16 of the DPDP Act. Payment data that Indian payment-system rules require to be stored in India is stored in India by the licensed partner that runs the payment, and we will not enable live Indian payouts for a flow until that requirement is met for it. A copy of the transfer clauses is available on request.</p>

      <H id="retention">6. How long we keep personal data</H>
      <Table head={["Data", "Kept for", "Why"]} rows={[
        ["Account data", "While your account is open, then 30 days to allow recovery, then deleted or anonymised unless a record below applies", "Service"],
        ["KYC/KYB records, screening results, transaction and payment records, purpose codes, certificates", "5 years after the relationship ends or the transaction completes, and longer where a law or open dispute requires (up to 8 years for tax and accounting records)", "Anti-money-laundering, exchange-control, tax and accounting laws in India, the UAE, Singapore, the US, the UK and the EU"],
        ["Invoices and tax documents you issue", "6 to 8 years, following the tax law of the seller", "Tax"],
        ["Security, audit and access logs", "1 year (not less than the 180 days that India\u2019s CERT-In directions require for system logs), longer if an investigation is open", "Security, CERT-In directions, accountability"],
        ["Marketing preferences and pilot enquiries", "Until you withdraw, or 24 months after the last contact", "Consent"],
        ["Backups", "Up to 35 days, then overwritten", "Resilience"],
      ]} />
      <p>When a retention period ends we delete or irreversibly anonymise the data. Where the law makes us keep a record after you ask for erasure, we restrict it to that purpose only and tell you.</p>

      <H id="rights">7. Your rights</H>
      <p>Everyone can ask us to: confirm whether we process their data and give a copy; correct or complete it; erase it (where we have no duty to keep it); withdraw consent for anything based on consent; and tell us if they believe we have mishandled it. Region-specific rights (for example to object, restrict, port data, opt out, appeal, nominate someone to act for you after death or incapacity) are in the <a className="text-gold underline" href="#b">regional notices</a>. How to use them:</p>
      <ul className="list-disc pl-6 space-y-1">
        <li>Use the <A href="/legal/data-requests">data-request form</A>, or email <A href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</A>. We confirm your identity first (signed-in account or a code sent to your email) so nobody can obtain your data by pretending to be you.</li>
        <li>We acknowledge a request within 7 days and answer within 30 days (45 days for US requests, extendable once by 45 days; one month for the EU and UK, extendable by two months for complex requests). We tell you if we need more time and why.</li>
        <li>Requests are free. We may charge a reasonable fee or refuse only for requests that are manifestly unfounded or excessive, or (Singapore) charge a reasonable access fee after telling you the amount first.</li>
        <li>If we refuse or only partly agree, we give the reason and tell you how to complain to us and to your regulator.</li>
      </ul>

      <H id="security">8. Security</H>
      <p>See our <A href="/legal/security">security overview</A>: encrypted storage of documents and identifiers, hashed passwords and codes, optional authenticator-app two-factor sign-in (mandatory for staff), signed webhooks, an append-only ledger, access logging and rate limits. No system is perfectly secure. If a breach of personal data occurs we investigate and contain it at once; tell the affected people and each regulator within the deadlines in the regional notices (for example 72 hours to India&apos;s Data Protection Board, the GDPR supervisory authority and Singapore&apos;s PDPC after we assess a breach as notifiable, and 6 hours to CERT-In for cyber incidents); and tell partners whose data is affected.</p>

      <H id="cookies">9. Cookies</H>
      <p>See the <A href="/legal/cookies">cookie notice</A>. In short: one essential sign-in cookie, no advertising or analytics cookies, no tracking across other sites.</p>

      <H id="children">10. Children</H>
      <p>Vaulte is for people aged 18 or over. We do not knowingly collect data about children. If we learn that we hold a child&apos;s data we delete it, and where the DPDP Act applies we process a child&apos;s data only with verifiable parental consent.</p>

      <H id="changes">11. Changes to this policy</H>
      <p>We will change this policy when our practices or the law change. The version and effective date are at the top of each page. For material changes we notify account holders by email and in the app and ask for acceptance where the law requires; earlier versions are available on request.</p>

      <H id="contact">12. Contact and complaints</H>
      <p>Start with <A href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</A>. If you are not satisfied, escalate to the Grievance Officer: {COMPANY.grievanceName}, <A href={`mailto:${COMPANY.grievanceEmail}`}>{COMPANY.grievanceEmail}</A>{COMPANY.grievancePhone ? `, ${COMPANY.grievancePhone}` : ""}, {COMPANY.address}; see the <A href="/legal/grievance">grievance page</A>. You may always go to your own regulator; their details are in the regional notice for your country.</p>

      <H id="b">Part B — Regional notices</H>
      <p>Choose the notice for where you live or where you use Vaulte from: {REGIONS.map((r, i) => <span key={r.slug}>{i > 0 ? " · " : ""}<Link className="text-gold underline" href={`/legal/privacy/${r.slug}`}>{r.name}</Link></span>)}. If you are in more than one place, the notice for each applies to the data it covers.</p>
    </LegalPage>
  );
}
