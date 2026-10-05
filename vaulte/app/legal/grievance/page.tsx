import LegalPage, { H } from "@/components/legal/LegalPage";
import { COMPANY } from "@/lib/legal";

export const dynamic = "force-dynamic";

export default function Grievance() {
  return (
    <LegalPage title="Grievance Officer and Complaints">
      <H>Grievance Officer</H>
      <p>Name: {COMPANY.grievanceName}<br />Email: {COMPANY.grievanceEmail}<br />Phone: {COMPANY.grievancePhone}<br />Address: {COMPANY.address}</p>
      <H>How to complain</H>
      <p>1. Write to {COMPANY.supportEmail} with your account email and the transfer reference. 2. If you are not satisfied within the time we state in our acknowledgement, escalate to the Grievance Officer above. We acknowledge complaints within [48 hours] and aim to resolve them within [30 days] [COUNSEL TO CONFIRM THE PERIODS REQUIRED IN EACH JURISDICTION].</p>
      <H>Data protection requests</H>
      <p>Requests to access, correct or erase personal data, or to withdraw consent, go to {COMPANY.privacyEmail}. If we do not resolve your concern you may approach the Data Protection Board of India or your local supervisory authority.</p>
      <H>Payments</H>
      <p>Because licensed partners execute payments, we may involve them in resolving a payment complaint. You may also have rights against the partner directly; their contact details are in the terms you accepted for them.</p>
    </LegalPage>
  );
}
