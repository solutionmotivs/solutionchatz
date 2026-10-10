import type { Metadata } from "next";
import PilotForm from "@/components/PilotForm";

export const metadata: Metadata = {
  title: "Join the Vaulte pilot",
  description: "Try cross-border payment quotes, invoices, verification and documents in test mode. Live payments only through licensed partners, country by country.",
};

export default function PilotPage() {
  return <PilotForm />;
}
