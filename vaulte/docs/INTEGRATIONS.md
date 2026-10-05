# Getting paid: links, email, API, e-commerce

Everything below creates a normal Vaulte invoice behind the scenes, so every payment gets the same sanctions screening, ledger entries, statements and documents as any other transfer. Vaulte never holds the money: licensed partners receive, convert and pay out.

| Way | How | Needs code? |
|---|---|---|
| Invoice or proforma by email | Dashboard → *Invoices & links* → Create and email | No |
| Shareable pay link | Dashboard, or `POST /api/payment-links` | No |
| Pay button on your site | `<a class="vaulte-pay" href="PAY_LINK">` + `/vaulte-pay.js` | Copy-paste |
| Hosted checkout for a shop | `POST /api/checkout/sessions` from your server, redirect the buyer to `url` | A few lines |
| Any platform | REST API + signed webhooks | Yes |

## 1. Hosted checkout (e-commerce)

```bash
curl -X POST https://YOUR_HOST/api/checkout/sessions \
  -H "Authorization: Bearer vlt_test_..." -H "Content-Type: application/json" \
  -d '{"currency":"USD","amount":4999,"description":"Order 1042","client_reference_id":"order_1042",
       "customer_email":"buyer@example.com",
       "success_url":"https://shop.example.com/thanks?order=1042","cancel_url":"https://shop.example.com/cart"}'
# -> {"id":"...","status":"open","url":"https://YOUR_HOST/pay/TOKEN", ...}
```

1. Create the session on **your server** (never in the browser: the API key is a secret).
2. Redirect the buyer to `url`. They pay on the hosted page; after payment it shows a "Return to your shop" button to your `success_url` (https only).
3. **Fulfil from the webhook, not the redirect.** The redirect only means the buyer clicked; the `invoice.paid` webhook means the payment completed. It carries your `client_reference_id` as `reference`.
4. You can also poll `GET /api/checkout/sessions/:id` (`status` is `open`, `complete` or `expired`).

Amounts are integers in minor units (cents). Use `line_items` instead of `amount` for itemised orders with tax rates.

### Verify the webhook (Node)

Each delivery has `X-Vaulte-Signature: t=<unix seconds>,v1=<hex>` and `X-Vaulte-Event-Id`. The signature is HMAC-SHA256 of `"<t>.<raw body>"` with your endpoint secret (full details: `GET /api/events/catalogue`).

```js
import { createHmac, timingSafeEqual } from "node:crypto";
export function verify(rawBody, header, secret, toleranceSec = 300) {
  const p = Object.fromEntries(header.split(",").map(kv => kv.split("=")));
  if (Math.abs(Date.now() / 1000 - Number(p.t)) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${p.t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(p.v1 ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}
```
Always verify against the **raw** request body, ignore event ids you have already processed (deliveries can repeat), and return 2xx quickly.

## 2. Pay link and button

```bash
curl -X POST https://YOUR_HOST/api/payment-links -H "Authorization: Bearer vlt_..." -H "Content-Type: application/json" \
  -d '{"amount":12000,"currency":"USD","description":"Consulting, March","payer_email":"client@example.com","send_email":true}'
```
```html
<a class="vaulte-pay" href="https://YOUR_HOST/pay/TOKEN">Pay with Vaulte</a>
<script src="https://YOUR_HOST/vaulte-pay.js" async></script>
```
Add `data-target="popup"` to open it in a small window.

## 3. WooCommerce, Shopify and other platforms

There is **no ready-made plugin** yet. Until there is, the pattern is the same on every platform:
- *Shopify / Wix / Squarespace / any hosted shop*: create a payment link (or checkout session via a small serverless function, e.g. Cloudflare Worker or Vercel function) and send the buyer there; mark the order paid from the `invoice.paid` webhook.
- *WooCommerce*: a custom gateway plugin calls `/api/checkout/sessions` in `process_payment()`, returns `['result'=>'success','redirect'=>$url]`, and a REST endpoint receives the webhook and calls `$order->payment_complete()`. Treat any sample you find as untested until you have run it against your store.

## 4. Rules that keep this lawful

- Pay pages and links are for genuine commercial or personal payments; sanctions screening and guardrails apply to every payer.
- Unverified (test-mode) organisations can email at most 3 invoices a day and only move test money.
- Return URLs must be https (plain http only for localhost in development).
- Card payments are not offered: payers fund by stablecoin or bank transfer through licensed partners.
