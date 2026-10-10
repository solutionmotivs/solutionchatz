import type { Metadata } from "next";
import CorridorPage from "@/components/corridors/CorridorPage";

export const metadata: Metadata = {
  title: "India to Singapore business payments — SGD to your supplier's bank | Vaulte",
  description: "Pay Singapore suppliers and group companies from India. Rupees in, Singapore dollars out, with every fee shown on the quote.",
};

export default function IndiaToSingapore() {
  return <CorridorPage {...({
      "from": "India",
      "to": "Singapore",
      "fromFlag": "🇮🇳",
      "toFlag": "🇸🇬",
      "fromCurrency": "INR",
      "toCurrency": "SGD",
      "headline": "Pay Singapore suppliers from India, with every fee on the quote.",
      "subheadline": "Fund in rupees through an authorised partner. Your Singapore recipient gets SGD in their bank. No crypto is involved on the Indian side.",
      "stats": [
            {
                  "label": "You fund in",
                  "value": "INR"
            },
            {
                  "label": "Recipient gets",
                  "value": "SGD"
            },
            {
                  "label": "Arrival target",
                  "value": "Same day to next business day"
            }
      ],
      "rails": [
            {
                  "name": "Vaulte route (via authorised partner)",
                  "speed": "Target: same day to next business day",
                  "cost": "Partner fees + Vaulte markup, shown on the quote",
                  "best": "Business payments to Singapore"
            },
            {
                  "name": "Typical bank wire",
                  "speed": "Often 2–7 working days",
                  "cost": "Fixed fee plus an FX margin (varies by bank)",
                  "best": "Existing bank process for large amounts"
            }
      ],
      "faq": [
            {
                  "q": "Can I pay a group company in Singapore?",
                  "a": "Possibly, depending on the purpose and the documents. Intra-group payments have their own rules. Please check with your CA or bank before sending."
            },
            {
                  "q": "Is there a cap per payment?",
                  "a": "The cross-border payment aggregator route is capped at ₹25 lakh per transaction."
            },
            {
                  "q": "Who verifies the recipient?",
                  "a": "The licensed partner, before payment details are issued."
            }
      ],
      "metaTitle": "India to Singapore business payments | Vaulte",
      "metaDescription": "Rupees in, SGD out. Licensed partners, transparent fees."
})} />;
}
