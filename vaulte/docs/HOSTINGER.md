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
The in-app scheduler (`ENABLE_INTERNAL_SCHEDULER=true`) only works if the Node process stays running. Shared hosting can stop idle Node processes, so also set a cron job (hPanel, Advanced, Cron jobs) every 5 minutes: `curl -s -X POST -H "x-cron-secret: $CRON_SECRET" "https://vaulte.iaexnetwork.com/api/internal/jobs/run?name=webhooks"`, and daily for `sanctions-ofac`, `sanctions-un`, `sanctions-uk`, `sanctions-rescreen`, `certificate-poll`; and every 2 minutes `partner-reconcile`, every 10 minutes `partner-onboarding` when a partner such as Nium is connected. Job names are listed in `lib/scheduler.ts`.

## DNS and SSL (what actually worked)
`iaexnetwork.com` uses **Cloudflare nameservers**, so a subdomain created in Hostinger is not public until an **A record** is added in Cloudflare (`vaulte` -> the Hostinger server IP, DNS only / grey cloud). Create the subdomain and the A record first, then request the certificate (`hosting_ssl_install`); a certificate requested before the record exists fails the domain challenge and keeps retrying, so uninstall and install again. Email records for Resend also go into Cloudflare.

## Deploy loop used
Upload a `git archive` tarball to the site (TUS upload), then `Start Node.js build` with source `archive`, framework `next`, Node 22, build script `build:hostinger`. Production-mode installs skip dev dependencies, so the build tools (typescript, tailwind, postcss, prisma, vitest, `@types/*`) are regular dependencies.

## Checks after deploy
`/api/health/ready` all green, `/quote`, `/pilot`, register with an emailed code, security headers, sanctions lists loaded (`POST /api/internal/sanctions/sync?list=OFAC_SDN` etc. with the cron secret), then `BASE_URL=https://vaulte.iaexnetwork.com node scripts/preflight.mjs` (it will still list the live-money blockers by design).

## Two environments (set up 2026-10-08)
| | **Production** `https://vaulte.iaexnetwork.com` | **Sandbox** `https://vaulte-sandbox.iaexnetwork.com` |
|---|---|---|
| Purpose | the real service; no live partner is configured yet, so no live money | developer and customer testing with fake money |
| Mode | `DEMO_MODE` off; emailed one-time codes via Resend; encrypted S3 documents; manual KYC review | `DEMO_MODE=true` (banner on every page, mock KYC, login code shown on screen), no email key |
| Database | Neon database `neondb` | Neon database `vaulte_sandbox` (same project, separate data) |
| Documents | bucket `vaulte-documents` | bucket `vaulte-sandbox-documents` |
| Secrets | its own | its own, generated separately; nothing is shared except the Neon project and company details |
| Partners | none live; add live partner keys only here, after contracts and counsel sign-off | partner sandboxes only: Currencycloud demo now (`CURRENCYCLOUD_ENV=demo`), Airwallex sandbox when the keys arrive |
| Links | `NEXT_PUBLIC_SANDBOX_URL` adds a "Developer sandbox" link to the footer | `PRODUCTION_URL` adds a link to the live site in the banner |
Rules: never put a live partner key in the sandbox, never a sandbox key in production, never point both at one database. Each environment has its own Hostinger cron jobs with its own `CRON_SECRET`. To add the next partner sandbox, set its variables in the sandbox environment only (the env API replaces the whole set; resend every variable) and redeploy.
The health endpoint installs the ledger triggers on a fresh database when `LEDGER_GUARDS_AUTOINSTALL=true`, so a new environment turns green on its first `/api/health/ready` call.
