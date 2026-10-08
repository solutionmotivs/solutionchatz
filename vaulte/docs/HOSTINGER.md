# Running Vaulte on Hostinger (Business web hosting, Node.js)

Target: `https://vaulte.iaexnetwork.com`. Status: pilot (no live partners, no live money). Written for the `hostinger_business_v2` plan.

## Why the database is not on Hostinger
Hostinger web hosting offers MySQL only. Vaulte needs **PostgreSQL** (arrays, JSON, enums, BigInt and the triggers that make the ledger append-only). So the app runs on Hostinger and the database is an external managed Postgres (free tier is enough for a pilot). Keep the free tier's limits in mind: pausing after inactivity, storage cap. Move to a paid plan, in a region near your users (India for Indian payment data), before real customers.

## What you need (all free tiers)
| What | Why | Variables |
|---|---|---|
| Postgres (for example Supabase or Neon) | the database | `DATABASE_URL` (pooled URL, with `pgbouncer=true`) and `DIRECT_URL` (non-pooled; the build uses it for `prisma db push`) |
| S3-compatible bucket (Supabase Storage S3, Cloudflare R2, Backblaze B2) | KYC documents, encrypted by the app before upload | `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Resend | emailed OTPs and notifications; verify the sending domain with DNS records | `RESEND_API_KEY`, `EMAIL_FROM` |

## Build and start
- Framework `next`, Node 22, root directory = the folder holding `package.json`, build script `build:hostinger` (runs `prisma generate`, `prisma db push --skip-generate`, then `next build`). The database must be reachable from the Hostinger build.
- The ledger's database triggers install at first start (`LEDGER_GUARDS_AUTOINSTALL=true`).
- Environment variables are set through hPanel (Node.js app, Environment) or the API. The API call **replaces the whole set**, and build-time values need a new build.

## Environment (pilot)
`NODE_ENV=production`, `NEXT_PUBLIC_APP_URL=https://vaulte.iaexnetwork.com`, `DATABASE_URL`, `JWT_SECRET`, `OTP_PEPPER`, `ENCRYPTION_KEY` (each 40+ random characters), `CRON_SECRET`, `MOCK_PARTNER_WEBHOOK_SECRET`, `LEDGER_GUARDS_AUTOINSTALL=true`, `KYC_SERVICES=mock` (until a real KYC provider is contracted), the S3 and Resend variables above, and the company details for the legal pages (`COMPANY_LEGAL_NAME`, `COMPANY_ADDRESS`, `GRIEVANCE_OFFICER_NAME`, `GRIEVANCE_OFFICER_EMAIL`, `SUPPORT_EMAIL`, `DATA_REGION`, `GOVERNING_LAW`). Leave `DEMO_MODE` and `AUTH_EXPOSE_DEV_OTP` **unset** (they show login codes on screen). Do not set `PARTNER_CATALOG_JSON` or `LIVE_COUNTRIES`: with no live catalogue no real money can move.

## Scheduled jobs
The in-app scheduler (`ENABLE_INTERNAL_SCHEDULER=true`) only works if the Node process stays running. Shared hosting can stop idle Node processes, so also set a cron job (hPanel, Advanced, Cron jobs) every 5 minutes: `curl -s -X POST -H "x-cron-secret: $CRON_SECRET" "https://vaulte.iaexnetwork.com/api/internal/jobs/run?name=webhooks"`, and daily for `sanctions-ofac`, `sanctions-un`, `sanctions-uk`, `sanctions-rescreen`, `certificate-poll`. Job names are listed in `lib/scheduler.ts`.

## Checks after deploy
`/api/health/ready` all green, `/quote`, `/pilot`, register with an emailed code, security headers, sanctions lists loaded (`POST /api/internal/sanctions/sync?list=OFAC_SDN` etc. with the cron secret), then `BASE_URL=https://vaulte.iaexnetwork.com node scripts/preflight.mjs` (it will still list the live-money blockers by design).
