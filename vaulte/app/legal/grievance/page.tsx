import LegalPage, { A, H, Table } from "@/components/legal/LegalPage";
import { COMPANY } from "@/lib/legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Grievance Officer and Complaints" };

export default function Grievance() {
  return (
    <LegalPage title="Grievance Officer and Complaints" subtitle="Who to write to, what happens next, and where to go if we cannot resolve it.">
      <H>Grievance Officer and Data Protection contact</H>
      <p>Name: {COMPANY.grievanceName}<br />Email: <A href={`mailto:${COMPANY.grievanceEmail}`}>{COMPANY.grievanceEmail}</A><br />{COMPANY.grievancePhone ? <>Phone: {COMPANY.grievancePhone}<br /></> : null}Address: {COMPANY.address}<br />Hours: Monday to Friday, 10:00 to 18:00 India Standard Time, excluding Indian public holidays.</p>
      <p>The Grievance Officer is also our contact under the Digital Personal Data Protection Act, 2023, our Data Protection Officer for the Singapore Personal Data Protection Act, and the point of contact for the other privacy laws listed in the <A href="/legal/privacy">Privacy Policy</A>.</p>
      <H>How to complain</H>
      <ol className="list-decimal pl-6 space-y-1">
        <li>Write to <A href={`mailto:${COMPANY.supportEmail}`}>{COMPANY.supportEmail}</A> with your account email, the transfer or invoice reference and what went wrong. We give you a reference number.</li>
        <li>We acknowledge within 2 business days and aim to resolve within 15 business days. For complex cases we tell you what we are doing and when you will hear from us, and we resolve within 30 days.</li>
        <li>If you are not satisfied, or do not hear from us in time, escalate to the Grievance Officer above. The Grievance Officer replies within 15 days with a final answer from us.</li>
        <li>If it is still not resolved, you may go to the authority for your country listed below, and to the courts or arbitration as the <A href="/legal/terms">Terms</A> provide.</li>
      </ol>
      <H>Data protection requests</H>
      <p>Requests to access, correct or erase personal data, to withdraw consent, or to use any other privacy right go through the <A href="/legal/data-requests">data-request form</A> or to <A href={`mailto:${COMPANY.privacyEmail}`}>{COMPANY.privacyEmail}</A>.</p>
      <H>Payments</H>
      <p>Because licensed partners execute payments, we may involve them in resolving a payment complaint, and share the facts of the transaction with them for that purpose. You may also have rights against the partner directly (for example error-resolution and refund rights); the partner&apos;s contact details are in the terms you accepted for it. Vaulte does not hold your money and cannot refund a payment that a partner holds or has sent, but we will press the partner for you.</p>
      <H>Where to go if we cannot resolve it</H>
      <Table head={["Country or region", "Data protection", "Financial and consumer matters"]} rows={[
        ["India", "Data Protection Board of India (after using our grievance process)", "Reserve Bank of India Integrated Ombudsman Scheme (for complaints about the regulated partner); National Consumer Helpline 1915 / consumer commissions"],
        ["United States", "State attorney general; California Privacy Protection Agency (California)", "Consumer Financial Protection Bureau; state financial regulator; California DFPI"],
        ["United Arab Emirates", "UAE Data Office; DIFC Commissioner of Data Protection; ADGM Office of Data Protection", "Central Bank of the UAE Consumer Protection (for complaints about the regulated partner)"],
        ["Singapore", "Personal Data Protection Commission", "Financial Industry Disputes Resolution Centre; Monetary Authority of Singapore (partner matters)"],
        ["European Union", "Supervisory authority in your member state", "National financial ombudsman or authority"],
        ["United Kingdom", "Information Commissioner's Office", "Financial Ombudsman Service; Financial Conduct Authority (partner matters)"],
      ]} />
    </LegalPage>
  );
}
