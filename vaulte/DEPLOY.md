# Deployment notes

Vaulte is a Next.js 14 app + PostgreSQL (Prisma). Everything runs in sandbox with mock partners; see `README.md` ("Before real money").

## Environment
Copy `.env.example`. Required: `DATABASE_URL`, `JWT_SECRET` (>= 32 chars), `NEXT_PUBLIC_APP_URL`.
Required for specific endpoints: staff accounts with two-factor for `/api/admin/*` (see `scripts/create-staff.mjs`), `CRON_SECRET` for `/api/internal/webhooks/run`,
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

## Scheduled jobs
Call with header `x-cron-secret: $CRON_SECRET`:
- `POST /api/internal/webhooks/run` every minute (customer webhook delivery).
- `POST /api/internal/sanctions/sync` daily, then `POST /api/internal/sanctions/rescreen` (list refresh and customer re-screening). Run the sync once before first launch: with no lists loaded, production screening sends everything to review.

## Ledger database guards
After `prisma migrate deploy` / `db push`, run once: `BASE_URL=... CRON_SECRET=... node scripts/db-guards.mjs`. It installs the append-only, balance and closed-period triggers. The app user must own the tables for this (or have a DBA run the same statements from `lib/ledger/guards.ts`). In production the app refuses to post journals until they exist.
- `POST /api/internal/erp/sync` every 15 minutes (push new completed transfers to connected accounting systems).
