import LegalPage, { A, H } from "@/components/legal/LegalPage";
import DataRequestForm from "@/components/legal/DataRequestForm";
import { COMPANY } from "@/lib/legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your data rights" };

export default function DataRequests() {
  return (
    <LegalPage title="Your data rights" subtitle="Ask to see, correct, delete, move or limit your personal data, or to withdraw consent.">
      <p>You can use this form wherever you live. The rights available depend on your country; the <A href="/legal/privacy">Privacy Policy</A> and the regional notices explain them. We confirm it is really you before releasing or changing anything, so a stranger cannot get your data. Requests are free.</p>
      <H>How long it takes</H>
      <p>We acknowledge immediately by email and answer within 30 days (45 days for US requests, with a possible extension of 45 days; one month for the EU and UK, with a possible extension of two months for complex requests). You can also write to <A href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</A>.</p>
      <DataRequestForm />
      <H>Signed in?</H>
      <p>Account holders can also change their profile details directly in the app, and close an account when no transfer is pending.</p>
    </LegalPage>
  );
}
