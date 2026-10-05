# Deployment notes

Vaulte is a Next.js 14 app + PostgreSQL (Prisma). Everything runs in sandbox with mock partners; see `README.md` ("Before real money").

## Environment
Copy `.env.example`. Required: `DATABASE_URL`, `JWT_SECRET` (>= 32 chars), `NEXT_PUBLIC_APP_URL`.
Required for specific endpoints: `ADMIN_API_TOKEN` (>= 24 chars) for `/api/admin/*`, `CRON_SECRET` for `/api/internal/webhooks/run`,
`MOCK_PARTNER_WEBHOOK_SECRET` if mock partners are enabled in production.

## Database
```bash
npx prisma generate
npx prisma db push        # fine for sandbox; use migrations (prisma migrate) before production
```

## Hosting
- Any Node host (Vercel, Render, Railway, VPS). Node 18+.
- **Cron:** call `POST /api/internal/webhooks/run` with header `x-cron-secret: $CRON_SECRET` every minute. It delivers and retries customer webhooks.
- Serverless caveat: the original `/api/payments` sandbox simulation uses `setTimeout` and will not run on serverless. The new transfer flow does not
  rely on timers; sandbox progress is driven by `POST /api/sandbox/partner/simulate`.
- Put the app behind HTTPS. Webhook URLs must be https in production; private/loopback addresses are rejected.

## Partners
Real partner adapters implement `lib/psp/stablecoin/partner.ts` and register in `lib/psp/stablecoin/registry.ts`. Point each partner's webhook at
`POST /api/webhooks/partner/<partner-id>` and implement `verifyWebhook` for its signature scheme.

## Checks before going live
Legal opinion, signed partner agreements, real KYB/KYC + sanctions screening, staff accounts for admin actions, shared rate limiting,
monitoring and backups. Not done in this repo.
