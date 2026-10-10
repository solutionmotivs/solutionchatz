import type { Metadata } from "next";
import CorridorPage from "@/components/corridors/CorridorPage";

export const metadata: Metadata = {
  title: "Cross-border payments API — quotes, transfers, virtual accounts | Vaulte",
  description: "A REST API for cross-border payments: firm quotes, transfers, per-customer virtual accounts, signed webhooks and a sandbox that behaves like production.",
};

export default function PaymentApi() {
  return <CorridorPage {...({
      "from": "Your platform",
      "to": "Your customers",
      "fromFlag": "💻",
      "toFlag": "🌍",
      "fromCurrency": "USD",
      "toCurrency": "EUR",
      "headline": "One API for cross-border payments, with licensed partners behind it.",
      "subheadline": "Request a firm quote, create a transfer, receive signed webhooks, and open per-customer virtual accounts that sweep each credit straight into a payout. Funds stay with the partner.",
      "stats": [
            {
                  "label": "Quote",
                  "value": "POST /api/quotes"
            },
            {
                  "label": "Transfer",
                  "value": "POST /api/stablecoin/payins"
            },
            {
                  "label": "Accounts",
                  "value": "POST /api/virtual-accounts"
            }
      ],
      "rails": [
            {
                  "name": "Vaulte API",
                  "speed": "Routing across several partners with failover",
                  "cost": "Itemised in every quote",
                  "best": "Platforms, marketplaces and payroll tools"
            },
            {
                  "name": "Direct partner integrations",
                  "speed": "One integration per partner",
                  "cost": "Per partner contract",
                  "best": "Teams that want to manage partners themselves"
            }
      ],
      "faq": [
            {
                  "q": "How are webhooks secured?",
                  "a": "Each delivery carries an X-Vaulte-Signature header with a timestamp and an HMAC-SHA256 signature. Failed deliveries are retried with backoff."
            },
            {
                  "q": "What is a virtual account?",
                  "a": "Local receiving details (for example an IBAN) issued by a licensed partner for your customer. Credits are converted and paid out immediately; no balance is kept."
            },
            {
                  "q": "Is there a sandbox?",
                  "a": "Yes. The sandbox uses mock partners and a simulator endpoint, so you can test deposits, payouts, failures and failover without real money."
            },
            {
                  "q": "Does Vaulte hold funds?",
                  "a": "No. Licensed partners do."
            }
      ],
      "metaTitle": "Cross-border payments API | Vaulte",
      "metaDescription": "Quotes, transfers, virtual accounts and signed webhooks. Licensed partners hold the funds."
})} />;
}
