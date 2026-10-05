import type { Metadata } from "next";
import CorridorPage from "@/components/corridors/CorridorPage";

export const metadata: Metadata = {
  title: "India to Europe business payments — euros to your supplier's bank | Vaulte",
  description: "Pay European suppliers from India. Fund in rupees; your supplier receives euros, with SEPA Instant for the last mile where the partner supports it.",
};

export default function IndiaToEU() {
  return <CorridorPage {...({
      "from": "India",
      "to": "EU",
      "fromFlag": "🇮🇳",
      "toFlag": "🇪🇺",
      "fromCurrency": "INR",
      "toCurrency": "EUR",
      "headline": "Pay European suppliers from India, with every fee on the quote.",
      "subheadline": "You pay in rupees through an authorised partner. Your supplier receives euros in their bank, with SEPA Instant for the final step where the partner supports it.",
      "stats": [
            {
                  "label": "You fund in",
                  "value": "INR"
            },
            {
                  "label": "Last mile",
                  "value": "SEPA (Instant where available)"
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
                  "best": "Business payments to EU suppliers"
            },
            {
                  "name": "Typical bank wire",
                  "speed": "Often 2–7 working days",
                  "cost": "Fixed fee plus an FX margin (varies by bank)",
                  "best": "When you need a bank-issued wire confirmation only"
            }
      ],
      "faq": [
            {
                  "q": "Do you send stablecoin to my supplier?",
                  "a": "No. Money from India moves as fiat. Your supplier receives euros in their bank account."
            },
            {
                  "q": "What about the ₹25 lakh limit?",
                  "a": "Cross-border payment aggregator transactions are capped at ₹25 lakh each. Larger amounts go through an authorised-dealer bank and are not instant."
            },
            {
                  "q": "Does the supplier need an account with Vaulte?",
                  "a": "They are added as a recipient and verified by the licensed partner before payment details are issued."
            },
            {
                  "q": "Is the exchange rate guaranteed?",
                  "a": "The quote is firm until its expiry time, usually a few minutes. After that you need a new quote."
            }
      ],
      "metaTitle": "India to Europe business payments | Vaulte",
      "metaDescription": "Pay European suppliers from India. Rupees in, euros out. Transparent fees."
})} />;
}
