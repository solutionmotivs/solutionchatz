import type { Metadata } from "next";
import CorridorPage from "@/components/corridors/CorridorPage";

export const metadata: Metadata = {
  title: "Receive INR from USDC and USDT payments — the compliant way | Vaulte",
  description: "Get paid by overseas clients in USDC or USDT and receive rupees in your Indian bank account, with the bank certificate and purpose code. No crypto in India.",
};

export default function StablecoinToINR() {
  return <CorridorPage {...({
      "from": "Overseas client",
      "to": "India",
      "fromFlag": "🌍",
      "toFlag": "🇮🇳",
      "fromCurrency": "USDC",
      "toCurrency": "INR",
      "headline": "Your client pays in USDC or USDT. You receive rupees in your bank.",
      "subheadline": "The stablecoin never enters India. A licensed partner receives and converts it outside India, and an RBI-authorised partner credits rupees to your bank with the paperwork a normal export receipt carries.",
      "stats": [
            {
                  "label": "You receive",
                  "value": "INR in your bank"
            },
            {
                  "label": "You hold crypto",
                  "value": "Never"
            },
            {
                  "label": "Documents",
                  "value": "Bank certificate + purpose code"
            }
      ],
      "rails": [
            {
                  "name": "Vaulte route (offshore conversion + authorised INR payout)",
                  "speed": "Target: same day to next business day",
                  "cost": "Partner fees + Vaulte markup, shown on the quote",
                  "best": "Export of services and goods invoiced by Indian businesses"
            },
            {
                  "name": "Receiving stablecoin in an Indian wallet",
                  "speed": "Fast, but not recommended",
                  "cost": "Taxable crypto transfer rules apply",
                  "best": "Not a compliant export receipt; the bank cannot close the export entry"
            }
      ],
      "faq": [
            {
                  "q": "Why not just receive USDT in my own wallet?",
                  "a": "Holding or selling it in India makes you a crypto holder for tax purposes: 30% tax on gains and 1% TDS on transfers, with no loss offsets. It is also not a banking-channel export receipt, so the bank cannot close your export entry."
            },
            {
                  "q": "Do you help me avoid tax?",
                  "a": "No. You still pay normal income tax (and GST where applicable) on your income. The structure only avoids creating a crypto transaction in India that you never actually made."
            },
            {
                  "q": "What is the per-payment limit?",
                  "a": "₹25 lakh per transaction on the cross-border payment aggregator route. Above that, use an authorised-dealer bank wire."
            },
            {
                  "q": "Is this personal or business?",
                  "a": "Business payments backed by an invoice. Family and friends transfers are a separate flow with its own limits."
            },
            {
                  "q": "Is this legal advice?",
                  "a": "No. Rules change and depend on your facts. Confirm with a CA or lawyer."
            }
      ],
      "metaTitle": "Receive INR from USDC and USDT payments | Vaulte",
      "metaDescription": "Overseas clients pay in stablecoin; you receive rupees in your bank with the bank certificate."
})} />;
}
