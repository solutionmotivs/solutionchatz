# Operations runbook (starting point)

## Scheduled jobs (all `POST` with header `x-cron-secret: $CRON_SECRET`)
| Job | Schedule | Endpoint |
|-----|----------|----------|
| Deliver customer webhooks | every minute | `/api/internal/webhooks/run` |
| Refresh sanctions lists | daily (and alert if it fails) | `/api/internal/sanctions/sync` |
| Re-screen customers | daily, after the sync | `/api/internal/sanctions/rescreen` |
| Push to accounting systems | every 15 minutes | `/api/internal/erp/sync` |
Alert if any job returns non-200 twice in a row, if the sanctions lists are older than 48 h (`/api/health/ready` goes 503 in production), or if a delivery sits dead-lettered.

## Health and monitoring
- Liveness: `GET /api/health`. Readiness: `GET /api/health/ready` (database, ledger guards, sanctions freshness, email, storage, secrets). Route traffic only to ready instances.
- Logs are one JSON object per line (`lib/log.ts`; secrets are redacted by key name). Every response carries `x-request-id`; quote it in support tickets. Ship stdout to a log platform and alert on `level:"error"`.
- Business alerts to add in your monitoring: transfers stuck in `QUARANTINED` > 4 h, `PAYING_OUT` > partner ETA × 2, KYC cases in review > SLA, open sanctions alerts > 4 h, reconciliation exceptions > 0 at end of day, `GET /api/admin/ledger/verify` not `ok`.

## Backups and restore
- PostgreSQL: continuous archiving / point-in-time recovery with at least 14 days retention, plus a daily logical dump copied to a second region. The ledger is append-only, so a restore never needs to reconcile edits, but it must be restored **together with** the document bucket.
- Document bucket (S3): versioning on, object lock/retention per your legal retention period, cross-region replication. Files are ciphertext: **back up `ENCRYPTION_KEY` separately (secret manager with its own backup)**. Without it every document and stored identifier is unreadable.
- Restore drill (quarterly): restore the database to a scratch instance, run `node scripts/db-guards.mjs` against it, call `/api/admin/ledger/verify` (chain must be `ok`), open a sample of documents, run `node scripts/e2e.mjs` against a staging copy if safe.
- RPO/RTO targets: set them with the business; the above supports an RPO of minutes and an RTO of hours.

## Incidents
1. Declare, assign a lead, open a timeline. 2. Contain: revoke sessions (`Session` rows), rotate affected keys, disable partner credentials, set `LEGAL_REVIEWED`/maintenance if needed. 3. Money: freeze new transfers by emptying `PARTNER_CATALOG_JSON` (fails closed), then reconcile what is in flight with each partner. 4. Data: if personal data may be exposed, start the breach-notification clock (regulators, partners, customers as the law requires: counsel). 5. Post-incident review with actions and owners.

## Runbooks
- **Ledger chain not ok**: stop posting (take the app out of rotation), identify the first broken `seq` from `/api/admin/ledger/verify`, compare with the last backup; never edit rows (triggers refuse). Fix forward with reversing journals only after the cause is understood.
- **Sanctions list stale/failed**: run `node scripts/sanctions-sync.mjs --force`; check egress to ofac.treas.gov, scsanctions.un.org, sanctionslist.fcdo.gov.uk; until fixed, review manual approvals.
- **Partner down**: failover is automatic where an alternate partner exists on the quote; otherwise transfers fail and reverse. Remove the partner's legs from `PARTNER_CATALOG_JSON` to stop new quotes.
- **Webhook backlog**: dead letters are replayable per event; for a whole endpoint, fix the receiver, then replay from the dashboard.
- **Key rotation**: `JWT_SECRET` (signs sessions: rotating logs everyone out), `OTP_PEPPER` (invalidates codes in flight), `CRON_SECRET`, partner and vendor secrets (rotate at the provider first). `ENCRYPTION_KEY` rotation needs a re-encryption job (not implemented: plan it before launch).
