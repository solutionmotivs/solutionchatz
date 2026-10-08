import { A, H } from "@/components/legal/LegalPage";
import { COMPANY } from "@/lib/legal";

const Ul = ({ items }: { items: React.ReactNode[] }) => <ul className="list-disc pl-6 space-y-1">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;

export function IndiaTerms() {
  return (
    <>
      <p>These terms apply to you if you, or the sender or recipient of your payment, are in India. They add to the <A href="/legal/terms">main Terms</A>.</p>
      <H>Regulatory position</H>
      <Ul items={[
        "Money entering India is received, converted and paid out only by Indian authorised dealer banks, payment-aggregator (cross-border) licensees or other entities authorised by the Reserve Bank of India. Vaulte is not one of them and does not hold money.",
        "Payments into India are fiat only. The recipient receives Indian rupees; no crypto-asset is delivered to an Indian recipient.",
        "Each payment must have a true purpose code and supporting invoice or document. Export receipts are reported by the authorised dealer through the Export Data Processing and Monitoring System; eFIRA, FIRC and eBRC are issued by the bank or the Directorate General of Foreign Trade, not by Vaulte.",
        "Individuals: remittances out of India follow the Liberalised Remittance Scheme and the limits set under the Foreign Exchange Management Act, 1999 (currently USD 250,000 per financial year); tax collected at source may apply; you must not use another person's limit. We enforce the limits we are told about and may refuse anything above them.",
      ]} />
      <H>Fees and taxes</H>
      <p>Fees exclude Goods and Services Tax, which we add at the rate in force (currently 18% on our service fee) and show on a tax invoice. Where an Indian customer or a customer with Indian operations must deduct tax at source or pay tax on a foreign remittance, that is their responsibility. We issue tax invoices with the particulars the GST law requires and keep copies for the period it specifies.</p>
      <H>Electronic records and consent</H>
      <p>You agree that these terms are an electronic contract under the Information Technology Act, 2000, valid without a physical signature. You consent to receive communications and statements electronically.</p>
      <H>Consumers and complaints</H>
      <p>If you are a consumer, nothing in these terms limits your rights under the Consumer Protection Act, 2019, including the right to approach a consumer commission. Complaints: the <A href="/legal/grievance">Grievance Officer</A>. Governing law: {COMPANY.governingLaw}. Disputes with businesses go to arbitration seated in New Delhi as the main Terms provide, and courts at New Delhi have exclusive jurisdiction for court proceedings that the arbitration clause allows or supports.</p>
      <H>Records</H>
      <p>We keep KYC and transaction records for at least 5 years after the relationship ends, as the Prevention of Money-laundering (Maintenance of Records) Rules, 2005 require, and share them with the Financial Intelligence Unit–India and other authorities as the law requires.</p>
    </>
  );
}

export function UsTerms() {
  return (
    <>
      <p>These terms apply to you if you, or the sender or recipient of your payment, are in the United States. They add to the <A href="/legal/terms">main Terms</A>.</p>
      <H>Who holds your money</H>
      <p>Vaulte is not a bank, is not a money transmitter, and does not hold your funds. Money that moves through a U.S. route is held and transmitted by a licensed partner (a bank, or a money transmitter licensed in the states where it operates). Funds held by a partner are not deposits with Vaulte, and are not insured by the Federal Deposit Insurance Corporation unless the partner tells you so in writing. The partner&apos;s terms, error-resolution procedures and consumer rights, including under the Electronic Fund Transfer Act and Regulation E and the Consumer Financial Protection Bureau&apos;s remittance rule where they apply, are the partner&apos;s to give; Vaulte will help you use them.</p>
      <H>Compliance</H>
      <p>You agree to provide the information we and our partners need under the USA PATRIOT Act, the Bank Secrecy Act, the rules of the Office of Foreign Assets Control and FinCEN, and the U.S. tax laws (for example a Form W-9 or W-8 series form). You may not use Vaulte to violate U.S. sanctions or export-control law. Foreign Account Tax Compliance Act and Common Reporting Standard information may be reported by our partners.</p>
      <H>Electronic communications (E-SIGN)</H>
      <p>You consent to receive records, notices and disclosures electronically under the Electronic Signatures in Global and National Commerce Act. You need a device with a modern browser and an email address. You may withdraw consent by closing your account, and you may ask for a paper copy at the address in the main Terms. We keep disclosures available in the app.</p>
      <H>Disputes</H>
      <p>The governing law and arbitration terms of the main Terms apply to businesses. If you are a consumer, they do not take away any right that a U.S. state or federal consumer-protection law gives you that cannot be waived, and you may bring an individual claim in small-claims court in your county of residence. Class-action waivers apply only where the law allows. <strong>California residents:</strong> under Civil Code section 1789.3 you may contact the Complaint Assistance Unit of the Division of Consumer Services of the California Department of Consumer Affairs at 1625 North Market Blvd., Suite N 112, Sacramento, CA 95834, or 1-800-952-5210. You may also contact the Department of Financial Protection and Innovation about any partner that is licensed in California.</p>
      <H>Records</H>
      <p>We keep identification and transaction records for at least 5 years as Bank Secrecy Act rules require.</p>
    </>
  );
}

export function UaeTerms() {
  return (
    <>
      <p>These terms apply to you if you, or the sender or recipient of your payment, are in the United Arab Emirates. They add to the <A href="/legal/terms">main Terms</A>.</p>
      <H>Regulatory position</H>
      <Ul items={[
        "Vaulte does not hold money and is not licensed by the Central Bank of the UAE, the Dubai Financial Services Authority, the Financial Services Regulatory Authority of ADGM or the Securities and Commodities Authority. Payments for UAE customers are held and moved by partners that hold the licences their activity needs, and their terms apply.",
        "Virtual assets: Vaulte does not provide virtual-asset services in the UAE. Stablecoin funding, where offered in a corridor, is performed by a partner licensed for it and is not available in a UAE route unless that partner says so.",
        "You must comply with Federal Decree-Law No. 20 of 2018 on anti-money-laundering and counter-terrorism financing, Cabinet Decision No. 10 of 2019 and the targeted financial sanctions regime, and you must provide accurate information about the origin and purpose of funds. We and our partners may report suspicious transactions to the UAE Financial Intelligence Unit and may be prohibited from telling you.",
      ]} />
      <H>Fees and VAT</H>
      <p>Fees exclude Value Added Tax, which we add where the law requires (currently 5%). Services supplied to a customer outside the UAE may be zero-rated, and we will show the treatment on the invoice. Payments in dirhams follow the fixed rate to the US dollar for conversions through partners that apply it, shown in the quote.</p>
      <H>Law, language and disputes</H>
      <p>The main Terms&apos; governing law and arbitration clause apply to businesses; the arbitration award may be enforced in the UAE courts under the New York Convention to which the UAE is a party. Mandatory UAE consumer-protection law and the courts of the UAE keep their jurisdiction where the law gives you that right. These terms are in English; if a UAE court or authority requires an Arabic version, we provide a translation on request and you bear the translation costs for a filing you start. Weekend and public-holiday cut-offs of UAE banks affect timing.</p>
    </>
  );
}

export function SingaporeTerms() {
  return (
    <>
      <p>These terms apply to you if you, or the sender or recipient of your payment, are in Singapore. They add to the <A href="/legal/terms">main Terms</A>.</p>
      <H>Regulatory position</H>
      <p>Vaulte does not hold money and is not licensed by the Monetary Authority of Singapore. Payments for Singapore customers are held and moved by partners licensed or exempt under the Payment Services Act 2019 (for example as a major payment institution), and their terms and safeguarding arrangements apply. Funds held by a partner for you may be safeguarded by that partner as the Act requires; Vaulte makes no promise beyond what the partner states. Digital-payment-token services are provided only by a partner licensed for them.</p>
      <H>Compliance</H>
      <p>You must provide accurate information on the nature and purpose of the transaction and the source of funds, and comply with the Corruption, Drug Trafficking and Other Serious Crimes (Confiscation of Benefits) Act, the Terrorism (Suppression of Financing) Act, and MAS directives on sanctions. We and our partners may file suspicious-transaction reports with the Suspicious Transaction Reporting Office and are not allowed to tell you.</p>
      <H>Taxes, third parties, disputes</H>
      <p>Fees exclude Goods and Services Tax, which we add where the law requires. The Contracts (Rights of Third Parties) Act 2001 does not give anyone other than the parties and the partners named in the main Terms a right to enforce these terms. The main Terms&apos; governing law and arbitration clause apply to businesses; judgments or awards may be enforced in Singapore. Nothing excludes liability that the Unfair Contract Terms Act 1977 does not allow to be excluded, or rights that the Consumer Protection (Fair Trading) Act 2003 gives a consumer. You can complain to us first and then to the Financial Industry Disputes Resolution Centre where a partner is a member of it and the dispute is within its scope.</p>
    </>
  );
}

export function EuUkTerms() {
  return (
    <>
      <p>These terms apply to you if you live in, or the sender or recipient of your payment is in, the European Economic Area or the United Kingdom. They add to the <A href="/legal/terms">main Terms</A>.</p>
      <H>Regulatory position</H>
      <p>Vaulte is not authorised or regulated by the Financial Conduct Authority, the Bank of Ireland, BaFin or any other competent authority as a payment, e-money or crypto-asset service provider. Payments for EU and UK customers are held and executed by partners that are authorised or registered under the Payment Services Directive (PSD2 and the UK Payment Services Regulations 2017), the E-Money rules, or the Markets in Crypto-Assets Regulation. The rights those rules give you (execution and refund rights, error and unauthorised-transaction rights, liability limits, safeguarding of funds) are rights against the partner, and the partner&apos;s terms describe them; Vaulte helps you use them. Vaulte offers live payment services in the EU or the UK only after the arrangements the law requires for those regions are in place.</p>
      <H>Crypto-assets</H>
      <p>Only e-money tokens authorised under MiCA (for example EURC) are offered in EU routes. Tether (USDT) is not offered to users in the EU. Vaulte does not give crypto-asset advice. Information that accompanies a crypto-asset transfer under Regulation (EU) 2023/1113 is collected and shared as that regulation requires.</p>
      <H>Consumers</H>
      <p>If you contract as a consumer, mandatory consumer law of the country where you live applies and cannot be excluded by the main Terms, and you may bring proceedings in the courts of that country. Clauses in the main Terms that limit our liability do not apply where the law says they cannot, and the arbitration clause applies only to businesses. The statutory 14-day right to cancel distance financial-services contracts does not apply to services whose price depends on financial-market movements, such as a currency conversion at a locked rate, or to a payment already executed at your request, as the law provides; where it does apply, you may cancel within 14 days of opening your account by writing to us, and we will refund any fee for services not yet used. EU consumers can also complain to the national out-of-court body for disputes with financial service providers, and UK consumers may go to the Financial Ombudsman Service where the partner is within its scope.</p>
      <H>Data and language</H>
      <p>Our <A href="/legal/privacy/eu-uk">EU and UK privacy notice</A> explains your data-protection rights. These terms are in English; if you need a version in another language to understand a decision that affects your rights, ask us.</p>
    </>
  );
}
