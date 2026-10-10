import type { Metadata } from "next";
import CorridorPage from "@/components/corridors/CorridorPage";

export const metadata: Metadata = {
  title: "India to USA business payments — local rupee funding, dollars abroad | Vaulte",
  description: "Pay US suppliers from India. Fund in rupees through an authorised partner; your supplier receives US dollars in their bank. Transparent quote, no crypto on the Indian side.",
};

export default function IndiaToUSA() {
  return <CorridorPage {...({
      "from": "India",
      "to": "USA",
      "fromFlag": "🇮🇳",
      "toFlag": "🇺🇸",
      "fromCurrency": "INR",
      "toCurrency": "USD",
      "headline": "Pay US suppliers from India, with every fee on the quote.",
      "subheadline": "You pay in rupees. An RBI-authorised partner sends dollars to your supplier's US bank. No crypto is involved on the Indian side, and you see the full cost before you commit.",
      "stats": [
            {
                  "label": "You fund in",
                  "value": "INR"
            },
            {
                  "label": "Arrival target",
                  "value": "Same day to next business day"
            },
            {
                  "label": "Crypto on the Indian side",
                  "value": "None"
            }
      ],
      "rails": [
            {
                  "name": "Vaulte route (via authorised partner)",
                  "speed": "Target: same day to next business day",
                  "cost": "Partner fees + Vaulte markup, shown on the quote",
                  "best": "Business payments for imports of goods and services"
            },
            {
                  "name": "Typical bank wire",
                  "speed": "Often 2–7 working days",
                  "cost": "Fixed fee plus an FX margin (varies by bank)",
                  "best": "Large one-off payments you already have a bank process for"
            }
      ],
      "faq": [
            {
                  "q": "Is paying a US supplier from India legal?",
                  "a": "Yes, when done through an authorised channel. For businesses, imports of goods and services are paid through an RBI-authorised cross-border payment aggregator or an authorised-dealer bank. Each payment needs the right documents. Please confirm your specific case with your CA or bank."
            },
            {
                  "q": "Is there a limit?",
                  "a": "Payments through the cross-border payment aggregator route are capped at ₹25 lakh per transaction. Above that, an authorised-dealer bank wire is used, which is not instant."
            },
            {
                  "q": "Can I fund with USDT or USDC from India?",
                  "a": "No. Money that starts in India is sent as rupees and delivered as local currency abroad. Vaulte blocks stablecoin funding from India."
            },
            {
                  "q": "Who holds my money during the transfer?",
                  "a": "The licensed partner. Vaulte does not hold customer funds."
            },
            {
                  "q": "What do I get after the payment?",
                  "a": "A status update by webhook and the documents your partner issues for the payment. Tax filing remains your CA's responsibility."
            }
      ],
      "metaTitle": "India to USA business payments | Vaulte",
      "metaDescription": "Pay US suppliers from India in rupees. Transparent quote, licensed partners."
})} />;
}
