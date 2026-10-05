import LegalPage, { H } from "@/components/legal/LegalPage";

export const dynamic = "force-dynamic";

export default function Disclosures() {
  return (
    <LegalPage title="Fee and Risk Disclosures">
      <p>Plain-language summary of what Vaulte charges, how money moves, and the risks. It supplements the Terms; it is not a substitute for them or for advice from your own advisers.</p>
      <H>Who holds your money</H>
      <p><strong>Vaulte does not hold your money.</strong> Licensed partners receive, convert, hold and pay out funds. In partner escrow a licensed escrow agent holds the buyer&apos;s money. In pay-on-approval deals no one holds money before approval. Funds held by partners are protected only as their licence, their safeguarding arrangements and local law provide: Vaulte is not a bank, and balances or deposits are not covered by a deposit-insurance scheme through Vaulte [COUNSEL TO CONFIRM wording per jurisdiction].</p>
      <H>What it costs</H>
      <p>Every quote itemises: the exchange rate used, the mid-market reference rate, the partner&apos;s costs and fees, and Vaulte&apos;s markup. Vaulte earns only its markup (a percentage of the amount, with a floor). The total you pay is shown before you confirm and is fixed for the life of the quote. If we choose between several providers, the comparison and the rate source are recorded on the quote. Banks and intermediaries outside our network may deduct their own charges on some SWIFT payments. Currency conversion always includes a spread; the quote shows it against the mid-market rate. Fees on invoices you issue are set by you.</p>
      <H>How long it takes</H>
      <p>Times are estimates. &quot;Instant&quot; means the partner&apos;s local rail (for example SEPA Instant, Faster Payments, FedNow, UPI) is available and nothing is held for review; cut-offs, public holidays, bank hours and compliance reviews can delay any payment.</p>
      <H>Risks to understand</H>
      <ul className="list-disc pl-5 space-y-2">
        <li><strong>Exchange-rate risk</strong> applies until a quote is accepted; after that the quoted amount applies as set out in the Terms.</li>
        <li><strong>Stablecoins</strong> (USDC, USDT) can lose their peg, be frozen by issuers or regulators, or be unavailable in some countries (for example USDT for EU users). Sending to the wrong address or the wrong network can lose funds permanently. Stablecoins are used only as a transfer leg handled by licensed partners; recipients in India are always paid in rupees by bank.</li>
        <li><strong>Pay-on-approval</strong> is not escrow: a seller may not be paid, and a buyer&apos;s money is not held in safekeeping.</li>
        <li><strong>Partner and bank risk</strong>: a partner can delay, hold or reject a payment, or fail. Refunds follow the partner&apos;s terms.</li>
        <li><strong>Regulatory limits</strong>: personal remittances have per-transaction and yearly limits; some countries are closed for live payments; sanctions screening can hold or block a payment.</li>
        <li><strong>Taxes and reporting</strong> on what you send or receive (income, GST/VAT, foreign-exchange and crypto rules) are your responsibility. Documents we generate are not tax or bank certificates.</li>
      </ul>
      <H>Cancelling and errors</H>
      <p>Tell us immediately if a payment looks wrong. Whether a transfer can be cancelled or recalled depends on how far it has progressed and on the partner. Some jurisdictions give consumers specific cancellation and error-resolution rights for remittances; those rights apply where the law gives them [COUNSEL TO ADD per jurisdiction].</p>
      <H>Complaints</H>
      <p>See the <a className="text-gold underline" href="/legal/grievance">grievance officer page</a> for how to complain, how long we take to respond and where to escalate.</p>
    </LegalPage>
  );
}
