import LegalPage, { H } from "@/components/legal/LegalPage";

export const dynamic = "force-dynamic";

export default function Aml() {
  return (
    <LegalPage title="AML, Sanctions and Compliance Policy">
      <p>Summary of how Vaulte and its licensed partners manage money-laundering, terrorist-financing and sanctions risk. The full internal policy, approved by the board and the compliance officer, is available to regulators and partners.</p>
      <H>Roles</H>
      <p>Vaulte does not hold customer funds. Licensed partners receive, convert and pay out money and carry their own regulatory obligations; Vaulte performs risk-based checks on its own platform, passes verification evidence to partners, and refuses transactions it cannot support. A designated compliance officer [NAME - TO BE APPOINTED] owns this programme.</p>
      <H>Customer due diligence</H>
      <p>Businesses (KYB): legal existence and registration, tax identifiers, beneficial owners above the applicable threshold (10% for companies in India; 25% elsewhere unless local law differs), directors and authorised signatory, bank account, purpose and expected volumes. Individuals (KYC): government ID, address, tax identifier where required, source of funds for higher-risk or larger remittances. Identifiers are checked against official sources through providers where available and otherwise by trained reviewers.</p>
      <H>Risk tiers</H>
      <p>Each customer receives a risk score and a due-diligence level: simplified, standard or enhanced. Politically exposed persons, high-risk industries and jurisdictions, large expected volumes, unclear ownership and screening matches lead to enhanced due diligence, which needs two different reviewers to approve. Transaction limits rise with the level. Customers are re-reviewed periodically (yearly for the highest risk) and on trigger events.</p>
      <H>Sanctions and watch-list screening</H>
      <p>Customers, owners, directors, counterparties and wallet addresses are screened against the OFAC SDN, UN consolidated and UK sanctions lists (lists refreshed daily; further lists such as the EU list are added as required). Screening is repeated on every transfer and for all customers daily. Possible matches are held for human review; confirmed matches are blocked and handled as the law requires. Transfers to or from prohibited jurisdictions are refused.</p>
      <H>Transaction monitoring and reporting</H>
      <p>Transactions are checked against purpose codes, invoices, limits and unusual patterns. Suspicious activity is escalated to the compliance officer, who decides on reports to the relevant financial intelligence unit and on any freezing, without tipping off the customer.</p>
      <H>Merchants, payment links and milestone deals</H>
      <p>Sellers who issue invoices, payment links, checkout sessions or milestone deals are verified like any other customer before live payments, and prohibited businesses are refused (see the Acceptable Use Policy). Buyers named in a deal are sanctions-screened before the deal is sent; buyers and payers are screened again when they pay. Escrow money, where offered, is held only by a licensed escrow agent, never by Vaulte. Unusual patterns such as repeated deals between the same parties without delivery, round-trip payments or links used far outside a seller&apos;s stated business are reviewed.</p>
      <H>Official registers</H>
      <p>Where an official register can be queried (EU VAT, LEI, UK and Australian company/business registers, Indian GST), registered names and statuses are used as evidence in verification. A register that is unavailable never approves or rejects a customer by itself: the case goes to manual review.</p>
      <H>India-specific controls</H>
      <p>Money originating in India is sent as fiat through authorised dealer channels only; recipients in India are paid in rupees through authorised channels, never in crypto. Business receipts require an invoice and a purpose code; personal remittances respect per-transaction, annual and LRS limits. Bank-issued certificates (eFIRA, FIRC, eBRC) are stored with the transaction.</p>
      <H>Records and training</H>
      <p>Verification and transaction records are kept for the legally required period in tamper-evident storage with access logging. Staff are trained on joining and annually.</p>
    </LegalPage>
  );
}
