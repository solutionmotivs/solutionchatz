// Install the ledger's database triggers (append-only rows, per-journal balance check, closed-period guard).
//   BASE_URL=https://app.example.com CRON_SECRET=... node scripts/db-guards.mjs
const r = await fetch((process.env.BASE_URL ?? "http://localhost:3000") + "/api/internal/ledger/guards", { method: "POST", headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" } });
console.log(r.status, JSON.stringify(await r.json().catch(() => null)));
process.exit(r.ok ? 0 : 1);
