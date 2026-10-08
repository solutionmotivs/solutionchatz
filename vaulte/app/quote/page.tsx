import type { Metadata } from "next";
import QuotePage from "@/components/QuotePage";

export const metadata: Metadata = {
  title: "Compare cost and speed",
  description: "Estimate what a cross-border payment costs and when it lands, with every fee shown. No account needed.",
};

export default function Page() {
  return <QuotePage />;
}
