import type { Metadata } from "next";
import BuyerDeal from "@/components/escrow/BuyerDeal";

export const metadata: Metadata = { title: "Review your deal", robots: { index: false, follow: false } };

export default function EscrowBuyerPage({ params }: { params: { token: string } }) {
  return <BuyerDeal token={params.token} />;
}
