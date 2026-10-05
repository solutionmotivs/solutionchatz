import type { Metadata } from "next";
import CorridorPage from "@/components/corridors/CorridorPage";

export const metadata: Metadata = {
  title: "A faster alternative to slow bank wires | Vaulte",
  description: "Cross-border payments that can arrive the same or next business day, with every fee on the quote and funds held by licensed partners.",
};

export default function BankWireAlternative() {
  return <CorridorPage {...({
      "from": "Your account",
      "to": "Recipient bank",
      "fromFlag": "🏦",
      "toFlag": "🌍",
      "fromCurrency": "USD",
      "toCurrency": "EUR",
      "headline": "Bank wires are slow and opaque. We show every fee up front.",
      "subheadline": "Vaulte compares routes across licensed partners, uses local instant rails where they exist, and shows the exact cost before you pay. Many routes target same-day or next-business-day arrival.",
      "stats": [
            {
                  "label": "Quote",
                  "value": "Firm for a few minutes"
            },
            {
                  "label": "Fees",
                  "value": "Itemised"
            },
            {
                  "label": "Funds held by",
                  "value": "Licensed partners"
            }
      ],
      "rails": [
            {
                  "name": "Vaulte route",
                  "speed": "Target: same day to next business day",
                  "cost": "Partner fees + Vaulte markup, itemised",
                  "best": "Business and personal cross-border payments"
            },
            {
                  "name": "Typical bank wire",
                  "speed": "Often 2–7 working days",
                  "cost": "Fixed fee plus an FX margin (varies by bank)",
                  "best": "Established bank relationships and very large amounts"
            }
      ],
      "faq": [
            {
                  "q": "Is Vaulte a bank or a payment institution?",
                  "a": "No. Vaulte is a technology platform. Licensed partners receive, convert, hold and pay out the money."
            },
            {
                  "q": "Why can it be faster?",
                  "a": "Routes use local instant rails (for example SEPA Instant, Faster Payments, FedNow) and, where legal, a stablecoin hop between partners instead of a chain of correspondent banks."
            },
            {
                  "q": "Is arrival time guaranteed?",
                  "a": "No. It is a target that depends on the route, partner, cut-off times and verification."
            },
            {
                  "q": "Which countries are supported?",
                  "a": "A limited set that grows with partners. The quote tells you immediately whether a corridor is available."
            }
      ],
      "metaTitle": "A faster alternative to bank wires | Vaulte",
      "metaDescription": "Itemised fees, licensed partners, same-day or next-business-day targets."
})} />;
}
