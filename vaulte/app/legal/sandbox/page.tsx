import LegalPage, { A, H } from "@/components/legal/LegalPage";

export const dynamic = "force-dynamic";
export const metadata = { title: "Test-mode Terms" };

export default function Sandbox() {
  return (
    <LegalPage title="Test-mode (sandbox) Terms" subtitle="What is real and what is not when you use Vaulte in test mode.">
      <p>Test mode lets you try quotes, invoices, payment links, verification, escrow flows, documents and the API without risking money. It is governed by the <A href="/legal/terms">Terms of Service</A> and these additional terms.</p>
      <H>Nothing in test mode is real</H>
      <ul className="list-disc pl-6 space-y-1">
        <li>No real money, crypto-asset or bank account is touched. Balances, transfers, virtual accounts, receipts, certificates (eFIRA, FIRC, eBRC) and statements produced in test mode are simulated and have no legal or tax value.</li>
        <li>Partners in test mode are simulated or are the partners&apos; own sandboxes. Rates, fees and times are illustrations and do not bind us or any partner in live mode.</li>
        <li>Verification in test mode may be automatic. Passing it does not mean you are verified for live payments, which has its own checks.</li>
      </ul>
      <H>Use fake data wherever you can</H>
      <p>Do not enter real card, bank, wallet, identity or secret data unless you want to test with it. Anything you enter is stored as described in the <A href="/legal/privacy">Privacy Policy</A>, so real personal data you enter in test mode is protected in the same way and deserves the same care. Test and live data are kept separate; test keys (prefix <code>vlt_test_</code>) cannot move live money.</p>
      <H>Availability</H>
      <p>Test mode is provided as is, may be reset, rate-limited or withdrawn, and has no service-level commitment.</p>
    </LegalPage>
  );
}
