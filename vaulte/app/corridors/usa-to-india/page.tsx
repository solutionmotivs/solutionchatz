import type { Metadata } from "next";
import CorridorPage from "@/components/corridors/CorridorPage";

export const metadata: Metadata = {
  title: "US to India business payments — pay in USDC or USDT, recipient gets rupees | Vaulte",
  description: "Pay Indian suppliers from the US. Send USDC, USDT or a bank transfer; the recipient receives rupees in their bank with the bank certificate and purpose code.",
};

export default function USAToIndia() {
  return <CorridorPage {...({
      "from": "USA",
      "to": "India",
      "fromFlag": "🇺🇸",
      "toFlag": "🇮🇳",
      "fromCurrency": "USD",
      "toCurrency": "INR",
      "headline": "Pay Indian suppliers from the US. They receive rupees, not crypto.",
      "subheadline": "Pay by bank transfer or with USDC or USDT. A licensed partner converts outside India, and an RBI-authorised partner pays rupees into your supplier's bank with the bank certificate and purpose code.",
      "stats": [
            {
                  "label": "You pay with",
                  "value": "USD bank, USDC or USDT"
            },
            {
                  "label": "Recipient gets",
                  "value": "INR in their bank"
            },
            {
                  "label": "Arrival target",
                  "value": "Same day to next business day"
            }
      ],
      "rails": [
            {
                  "name": "Vaulte route (stablecoin hop via licensed partners)",
                  "speed": "Target: same day to next business day",
                  "cost": "Partner fees + Vaulte markup, shown on the quote",
                  "best": "Invoice payments to Indian exporters and agencies"
            },
            {
                  "name": "Typical bank wire",
                  "speed": "Often 2–7 working days",
                  "cost": "Fixed fee plus an FX margin (varies by bank)",
                  "best": "Payments above ₹25 lakh per transaction"
            }
      ],
      "faq": [
            {
                  "q": "Does my Indian supplier receive crypto?",
                  "a": "No. The stablecoin leg stays outside India. Your supplier receives rupees in their bank account through an RBI-authorised partner."
            },
            {
                  "q": "What does my supplier need?",
                  "a": "An invoice for the export of goods or services, an RBI purpose code (for example P0802 for services), and verification with the licensed partner."
            },
            {
                  "q": "Is there a limit?",
                  "a": "Transactions through the cross-border payment aggregator route are capped at ₹25 lakh each. Larger payments need an authorised-dealer bank wire, which is not instant."
            },
            {
                  "q": "Can I use USDT?",
                  "a": "Yes, where the partners on the route are licensed to handle it. USDT is not available on EU-licensed legs, so some routes use USDC only."
            },
            {
                  "q": "Does the exporter pay crypto tax in India?",
                  "a": "Because they never receive or sell a crypto asset, the rules for crypto holders do not apply to them. Their income is taxed as normal export income. Please confirm with a CA."
            }
      ],
      "metaTitle": "US to India business payments | Vaulte",
      "metaDescription": "Pay Indian suppliers in USDC, USDT or USD. They receive rupees in their bank."
})} />;
}
