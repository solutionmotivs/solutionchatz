import { A, H, Table } from "@/components/legal/LegalPage";
import { COMPANY } from "@/lib/legal";

const Email = () => <A href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</A>;
const Dpo = () => <>{COMPANY.grievanceName}, <A href={`mailto:${COMPANY.grievanceEmail}`}>{COMPANY.grievanceEmail}</A></>;

export function IndiaPrivacy() {
  return (
    <>
      <p>This notice is given under section 5 of the Digital Personal Data Protection Act, 2023 and the Digital Personal Data Protection Rules, 2025 (together the &quot;DPDP law&quot;), and applies to you as a <em>Data Principal</em> when we process your digital personal data in India, or outside India in connection with offering services to you in India. Some provisions of the DPDP law come into force in stages; we apply the standards described here from today. Read it with <A href="/legal/privacy">Part A</A>.</p>
      <H>Our role</H>
      <p>{COMPANY.name} is the Data Fiduciary. Our licensed payment partners and verification providers are separate Data Fiduciaries for their own legal duties, or our Data Processors where they act only on our instructions under a contract. We have not been designated a Significant Data Fiduciary.</p>
      <H>The personal data and purposes this notice covers</H>
      <p>The data and purposes are listed in Part A, sections 2 and 3: account and contact details, identity and business verification data, screening results, transaction data, and technical and security data. We process them to create and run your account, verify you, instruct and record your payments, issue certificates and statements, prevent fraud and comply with law.</p>
      <H>Consent and the other lawful uses</H>
      <p>Where we ask for your consent we ask for it separately, in clear and plain language, with a choice to agree or decline, and we record it. You can withdraw consent as easily as you gave it, from your account settings or by writing to <Email />. Withdrawal does not affect processing already done, and if you withdraw consent for data that is necessary to provide a service, we will tell you what we can no longer do, and may close that service. We also process data without consent for the legitimate uses the DPDP law permits, mainly: data you voluntarily gave for a stated purpose and did not object to; compliance with a law or a court or regulatory order (for example the Prevention of Money-laundering Act, 2002 and its Rules, the Foreign Exchange Management Act, 1999, tax laws, and CERT-In directions); and responding to a medical emergency or disaster where relevant.</p>
      <H>Your rights as a Data Principal</H>
      <Table head={["Right", "How we honour it"]} rows={[
        ["Access", "A summary of the personal data we process and the processing we do, the identities of other Data Fiduciaries and Processors we have shared it with and a description of the data shared."],
        ["Correction, completion, updating", "We correct inaccurate or misleading data, complete incomplete data and update it. For verified records we may ask for a document that supports the change."],
        ["Erasure", "We erase your data when you withdraw consent or the purpose is served, unless a law requires us to retain it (Part A, section 6). We also ask our Processors to erase it."],
        ["Grievance redressal", "Write to the Grievance Officer. We acknowledge within 7 days and respond within 30 days, and never later than the 90 days the DPDP Rules allow."],
        ["Nominate", "You may nominate another individual to exercise your rights if you die or become unable to. Send us the nominee&apos;s details and consent through the data-request form."],
      ]} />
      <p>Please exercise these rights through the <A href="/legal/data-requests">data-request form</A>. Under the DPDP law you must not impersonate another person, suppress material information when providing data, or file false or frivolous complaints.</p>
      <H>Grievance Officer and the Data Protection Board</H>
      <p>Grievance Officer: <Dpo />{COMPANY.grievancePhone ? `, ${COMPANY.grievancePhone}` : ""}, {COMPANY.address}. If we do not resolve your grievance within the period above, or you are not satisfied, you may complain to the <strong>Data Protection Board of India</strong> through its digital office, after first using our grievance process.</p>
      <H>Children and persons with a disability</H>
      <p>Vaulte is for people aged 18 or over. If we learn that we hold personal data of a child, or of a person who has a lawful guardian, we will not process it without verifiable consent of the parent or lawful guardian, will not track or monitor the child, and will not use it for targeted advertising.</p>
      <H>Breach notification</H>
      <p>If a personal data breach happens we tell each affected Data Principal without delay, in plain language, with what happened, the likely consequences, what we have done, safety steps you can take and who to contact. We also inform the Data Protection Board without delay and give it the detailed report within 72 hours. We report cyber incidents to CERT-In within 6 hours as its directions require.</p>
      <H>Storage and transfers</H>
      <p>Transfers outside India happen as the DPDP law permits: to any country except those the Central Government restricts by notification, subject to stricter laws such as Reserve Bank of India rules on storage of payment-system data in India and any other sector law. We keep records in India or hold the data with the licensed Indian partner where those rules require.</p>
      <H>Other Indian laws</H>
      <p>Until the DPDP law fully replaces it we also follow the Information Technology (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011. We keep KYC and transaction records for the periods in the Prevention of Money-laundering (Maintenance of Records) Rules, 2005 and the Foreign Exchange Management Act, and GST records for the period the Central Goods and Services Tax Act requires.</p>
    </>
  );
}

export function UsPrivacy() {
  return (
    <>
      <p>This notice supplements <A href="/legal/privacy">Part A</A> for residents of the United States, including residents of California, Colorado, Connecticut, Delaware, Florida, Indiana, Iowa, Kentucky, Maryland, Minnesota, Montana, Nebraska, New Hampshire, New Jersey, Oregon, Rhode Island, Tennessee, Texas, Utah and Virginia, and any other state with a comprehensive privacy law. It is our notice at collection and our privacy notice under the California Consumer Privacy Act as amended by the California Privacy Rights Act (&quot;CCPA&quot;).</p>
      <H>Financial-privacy law</H>
      <p>Vaulte is not a bank and does not itself receive or hold customer funds. The licensed partners that do (banks, money transmitters and payment institutions) give you their own privacy notice under the Gramm-Leach-Bliley Act where it applies. Information that is subject to the Gramm-Leach-Bliley Act or the Fair Credit Reporting Act is exempt from most state privacy laws, so some of the rights below do not apply to it; they do apply to the rest of your data. We do not share your information with non-affiliated companies for them to market to you.</p>
      <H>Categories of personal information (past 12 months)</H>
      <Table head={["CCPA category", "Collected", "Disclosed for a business purpose to", "Sold or shared"]} rows={[
        ["Identifiers (name, email, address, IP address, account name)", "Yes", "Payment partners, verification and screening providers, hosting and email providers", "No"],
        ["Customer records and financial information (bank, wallet and payment details, transaction history)", "Yes", "Payment partners, providers", "No"],
        ["Government identifiers (tax IDs, passport and ID numbers) — sensitive", "Yes, for verification", "Verification and screening providers, partners", "No"],
        ["Account log-in with password — sensitive", "Yes (password hash only)", "No one", "No"],
        ["Commercial information (invoices, orders, purposes)", "Yes", "Partners, the seller or buyer on the transaction", "No"],
        ["Internet or network activity (device, logs)", "Yes", "Security and hosting providers", "No"],
        ["Geolocation (country level from IP address)", "Yes", "Security providers", "No"],
        ["Professional information (job title, employer)", "Yes", "Partners, providers", "No"],
        ["Inferences (risk rating from screening)", "Yes", "Partners", "No"],
        ["Biometric information", "Only if a face-match provider is enabled and you are told first", "The provider", "No"],
      ]} />
      <p>We use sensitive personal information only to provide the service, verify identity, prevent fraud and comply with law, so there is no right to limit its use beyond these purposes. We keep each category as set out in Part A, section 6. We have not sold or shared personal information in the past 12 months, and have no actual knowledge of selling or sharing the data of anyone under 16.</p>
      <H>Your rights</H>
      <Table head={["Right", "What it means"]} rows={[
        ["Know / access", "The categories and specific pieces of personal information we hold, the sources, the purposes and the recipients."],
        ["Delete", "We delete what we can; we must keep records the law requires (for example Bank Secrecy Act records for 5 years)."],
        ["Correct", "We correct inaccurate information."],
        ["Portability", "A copy in a portable, readily usable format."],
        ["Opt out of sale, sharing, targeted advertising and profiling with legal effects", "We do none of these. We also honour opt-out preference signals such as Global Privacy Control, although there is nothing to opt out of."],
        ["Limit use of sensitive information", "Used only for the permitted purposes above."],
        ["No retaliation", "We will not deny service, charge different prices or give a different quality of service because you use a right."],
      ]} />
      <H>How to make a request, and appeals</H>
      <p>Use the <A href="/legal/data-requests">data-request form</A> or email <Email />. We verify your identity by matching your request to your account or by emailing a code. You may use an authorised agent: send us their signed permission, and we may still verify you directly. We respond within 45 days, and may extend once by 45 more days with notice. If we decline a request you can appeal by replying to our decision with the word &quot;appeal&quot;; we answer within 60 days (45 days in some states) and, if we uphold the refusal, give you the state attorney general&apos;s contact details to complain. California residents may also contact the California Privacy Protection Agency.</p>
      <H>Other US notices</H>
      <ul className="list-disc pl-6 space-y-1">
        <li><strong>Do Not Track:</strong> we do not track you across other sites, so there is nothing to change when a browser sends the signal.</li>
        <li><strong>Children:</strong> Vaulte is for adults. We do not knowingly collect data from anyone under 18 and comply with the Children&apos;s Online Privacy Protection Act.</li>
        <li><strong>California &quot;Shine the Light&quot;:</strong> we do not disclose personal information to third parties for their direct marketing.</li>
        <li><strong>Data breaches:</strong> we notify residents and attorneys general as state breach laws require.</li>
        <li><strong>Records and sanctions:</strong> we keep identification and transaction records and run sanctions checks as U.S. anti-money-laundering and Office of Foreign Assets Control rules require, and may disclose them to authorities.</li>
      </ul>
    </>
  );
}

export function UaePrivacy() {
  return (
    <>
      <p>This notice supplements <A href="/legal/privacy">Part A</A> for people in the United Arab Emirates and for anyone whose personal data we process in connection with services offered to them in the UAE. It follows <strong>Federal Decree-Law No. 45 of 2021 on the Protection of Personal Data</strong> (&quot;PDPL&quot;) and its implementing rules as they apply from time to time. Where you are in the Dubai International Financial Centre or the Abu Dhabi Global Market, DIFC Data Protection Law No. 5 of 2020 or the ADGM Data Protection Regulations 2021 apply to processing by establishments there; we apply their standards to your data as well.</p>
      <H>Controller and contact</H>
      <p>The controller is {COMPANY.name}. Contact: <Email />. Data protection contact: <Dpo />.</p>
      <H>Lawful basis</H>
      <p>We process personal data with your consent where we ask for it, and without consent where the PDPL allows: to perform a contract with you or take steps at your request, to comply with the UAE&apos;s legal obligations (including anti-money-laundering and counter-terrorism-financing law and sanctions orders), to protect the public interest, to establish or defend legal claims, and for other grounds the PDPL lists. You can withdraw consent at any time; this does not affect earlier processing.</p>
      <H>Your rights</H>
      <Table head={["Right", "How we honour it"]} rows={[
        ["Information and access", "What data we process, why, with whom we share it, where it is stored, and for how long."],
        ["Correction and erasure", "We correct inaccurate data and erase data that is no longer needed, unless a law requires us to keep it."],
        ["Restriction", "We restrict processing while accuracy or lawfulness is disputed, or where you need data for a claim."],
        ["Objection and withdrawal", "You may object to processing based on our legitimate interests, to direct marketing, and to profiling."],
        ["Portability", "A copy of data you provided in a structured, commonly used, machine-readable form."],
        ["Automated decisions", "You may object to a decision made solely by automated processing that has legal or serious effect, and ask for a person to review it. Sanctions and risk flags are always reviewed by a person before any refusal."],
      ]} />
      <p>We respond within 30 days. Use the <A href="/legal/data-requests">data-request form</A> or email <Email />.</p>
      <H>Transfers out of the UAE</H>
      <p>We transfer data outside the UAE to a country with adequate protection, or where a contract with the recipient provides it, or with your consent, or where needed to perform a contract or for the establishment or defence of legal claims. Where DIFC or ADGM law applies we use their approved transfer tools.</p>
      <H>Breach notification and complaints</H>
      <p>If a breach could prejudice the privacy, confidentiality or security of your data we notify the UAE Data Office (and the DIFC Commissioner of Data Protection or the ADGM Office of Data Protection where they have jurisdiction) and affected individuals as the law requires. You may complain to us, and to the <strong>UAE Data Office</strong>, or, where it applies, the <strong>DIFC Commissioner of Data Protection</strong> or the <strong>ADGM Office of Data Protection</strong>.</p>
      <H>Records, language and sector rules</H>
      <p>We keep identification and transaction records for at least five years after the relationship ends as UAE anti-money-laundering law requires. The licensed partners that hold money for UAE customers are subject to Central Bank of the UAE rules, including its consumer protection standards, which apply to them. This notice is published in English; if you need an Arabic translation, ask us.</p>
    </>
  );
}

export function SingaporePrivacy() {
  return (
    <>
      <p>This notice supplements <A href="/legal/privacy">Part A</A> for individuals in Singapore and is our personal-data protection policy under the <strong>Personal Data Protection Act 2012</strong> (&quot;PDPA&quot;). It also applies to Singapore-based businesses&apos; individual directors, shareholders, beneficial owners and contacts whose personal data we process.</p>
      <H>Data Protection Officer</H>
      <p>Our Data Protection Officer is <Dpo />, reachable at <Email /> for any question about this policy, access and correction requests, withdrawal of consent, and complaints.</p>
      <H>How we apply the PDPA obligations</H>
      <Table head={["PDPA obligation", "What we do"]} rows={[
        ["Consent", "We collect, use and disclose personal data with your consent, or where deemed consent applies (data you give to carry out a transaction you requested, or necessary to perform a contract), or where the PDPA excepts consent (for example legal obligations, investigations, and legitimate interests such as fraud prevention where we have assessed the impact and benefit). You can withdraw consent by giving us reasonable notice, usually 10 business days; we tell you the consequences."],
        ["Purpose limitation and notification", "We use data only for the purposes in Part A, section 3, which a reasonable person would consider appropriate, and tell you before any new purpose."],
        ["Access and correction", "On request we give you your personal data held by us and how it was used or disclosed in the past year, within 30 days, and correct errors as soon as practicable, usually within 30 days, sending the correction to organisations we disclosed the data to in the past year, unless they do not need it. We may charge a reasonable fee for access and tell you first."],
        ["Accuracy", "We take reasonable steps to keep data accurate and complete, and you can update it in your account."],
        ["Protection", "Reasonable security arrangements: encryption of documents and identifiers, access controls, logging, staff confidentiality."],
        ["Retention limitation", "We stop retaining data, or de-identify it, once the purpose is served and retention is no longer needed for legal or business purposes (Part A, section 6), e.g. 5 years for anti-money-laundering records."],
        ["Transfer limitation", "We transfer data outside Singapore only if the recipient is bound by legally enforceable obligations, such as contracts, to give it a standard of protection comparable to the PDPA."],
        ["Data breach notification", "We assess a suspected breach promptly; if it is likely to cause significant harm or is of significant scale we notify the Personal Data Protection Commission as soon as practicable and no later than 3 calendar days after our assessment, and affected individuals as soon as practicable."],
        ["Accountability", "This policy, a designated DPO, a complaint process and staff training."],
      ]} />
      <H>National registration numbers</H>
      <p>We collect NRIC, FIN or other national identification numbers, or copies of those documents, only where the law requires it or where it is necessary to establish or verify identity to a high degree of fidelity. We mask them when displayed.</p>
      <H>Marketing messages</H>
      <p>We send marketing email only with your consent and do not send marketing calls or text messages, so the Do Not Call Registry rules are not triggered. You can unsubscribe at any time.</p>
      <H>Complaints</H>
      <p>Write to our DPO first. If you are not satisfied, you may complain to the <strong>Personal Data Protection Commission Singapore</strong> (pdpc.gov.sg).</p>
      <H>Financial regulation</H>
      <p>Money for Singapore customers is held and moved by partners licensed under the Payment Services Act 2019; Vaulte does not hold money. We apply Singapore anti-money-laundering record-keeping requirements (5 years) and MAS sanctions notices to our screening.</p>
    </>
  );
}

export function EuUkPrivacy() {
  return (
    <>
      <p>This notice supplements <A href="/legal/privacy">Part A</A> for people in the European Economic Area (&quot;EU&quot;), the United Kingdom and Switzerland, under Regulation (EU) 2016/679 (&quot;GDPR&quot;), the UK GDPR and Data Protection Act 2018, and the Swiss Federal Act on Data Protection.</p>
      <H>Controller, representatives and contact</H>
      <p>The controller is {COMPANY.name}, {COMPANY.address}. Privacy contact and data protection point of contact: <Email />, <Dpo />. {COMPANY.euRepresentative ? <>Our representative in the EU under Article 27 GDPR: {COMPANY.euRepresentative}. </> : null}{COMPANY.ukRepresentative ? <>Our representative in the UK: {COMPANY.ukRepresentative}. </> : null}{!COMPANY.euRepresentative || !COMPANY.ukRepresentative ? <>We do not offer live payments to customers in the EU or the UK until we have appointed the representative the law requires for those regions; until then you can contact us at the address above.</> : null} We have not appointed a Data Protection Officer because the law does not require one for our activities; the contact above handles those duties.</p>
      <H>Legal bases</H>
      <Table head={["Purpose", "Legal basis (GDPR Article 6)"]} rows={[
        ["Create and run your account, quote, instruct and record payments, invoices, certificates", "Performance of a contract with you, or steps you ask for before a contract (6(1)(b))"],
        ["Identity verification, sanctions and politically-exposed-person screening, anti-money-laundering records, tax and regulatory reporting", "Legal obligation (6(1)(c)); for sensitive data, substantial public interest in preventing money laundering and terrorist financing (Article 9(2)(g))"],
        ["Fraud prevention, security, abuse prevention, service analytics in aggregated form, defending legal claims", "Our legitimate interests (6(1)(f)), which we have balanced against your rights; you may object"],
        ["Product news and marketing emails", "Your consent (6(1)(a)), withdrawable at any time"],
        ["Optional face-match checks, if offered for your country", "Your explicit consent (Article 9(2)(a))"],
      ]} />
      <H>Automated decisions</H>
      <p>Risk scoring and sanctions matching are automated and may flag or hold a payment. We do not take a decision with legal or similarly significant effect on you solely by automated means: a trained person reviews every refusal, restriction or closure. You can ask for human review, state your view, and contest a decision, as Article 22 GDPR provides.</p>
      <H>Your rights</H>
      <p>You have the rights of access (Art. 15), rectification (16), erasure (17), restriction (18), notification of recipients (19), portability (20), objection (21, including absolute objection to direct marketing), and not to be subject to solely automated decisions (22). You can withdraw consent at any time. We respond within one month, extendable by two months for complex requests, with notice. Use the <A href="/legal/data-requests">data-request form</A> or email <Email />.</p>
      <H>International transfers</H>
      <p>Our infrastructure and some partners are outside the EU and UK (including India, Singapore, the UAE and the US), and these countries are not all covered by an adequacy decision. We transfer personal data under the European Commission&apos;s standard contractual clauses (Decision 2021/914) and, for the UK, the International Data Transfer Addendum, after a transfer risk assessment and with supplementary measures such as encryption. To the US we rely on the EU-US Data Privacy Framework (and its UK extension) where the recipient is certified. You can get a copy of the clauses by writing to us.</p>
      <H>Retention</H>
      <p>As in Part A, section 6. EU anti-money-laundering rules require us to keep identification and transaction records for 5 years after the relationship ends (up to 10 years where national law extends it).</p>
      <H>Complaints</H>
      <p>You may complain to us first, and always to a supervisory authority: in the EU, the authority in the country where you live, work or where the issue happened (the list is at edpb.europa.eu); in the UK, the <strong>Information Commissioner&apos;s Office</strong> (ico.org.uk); in Switzerland, the Federal Data Protection and Information Commissioner.</p>
      <H>Crypto-asset transfers</H>
      <p>Where a stablecoin transfer falls under Regulation (EU) 2023/1113, the originator and beneficiary information required by that regulation travels with the transfer and is shared with the receiving institution and authorities.</p>
    </>
  );
}
