// Small load/latency smoke test: N concurrent clients create quotes for a corridor and report p50/p95/p99 and error rate.
//   BASE_URL=https://staging.example.com API_KEY=vlt_test_... SENDER=<entity id> RECIPIENT=<entity id> node scripts/load-smoke.mjs [--clients 20] [--requests 200]
// Use a STAGING environment with TEST keys. Quotes are free and idempotent-safe; do not point this at production.
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
const base = process.env.BASE_URL, key = process.env.API_KEY, sender = process.env.SENDER, recipient = process.env.RECIPIENT;
if (!base || !key || !sender || !recipient) { console.error("Set BASE_URL, API_KEY, SENDER and RECIPIENT (entity ids)"); process.exit(2); }
const clients = arg("clients", 20), total = arg("requests", 200);
const body = JSON.stringify({ kind: "BUSINESS", sender_entity_id: sender, recipient_entity_id: recipient, source_currency: "USD", dest_currency: "INR", source_amount: 500000, funding_method: "FIAT_LOCAL", prefer: "cheapest" });
const lat = []; let errors = 0, sent = 0; const codes = {};
async function worker() {
  while (sent < total) {
    sent++;
    const t = performance.now();
    try { const r = await fetch(`${base}/api/quotes`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body }); codes[r.status] = (codes[r.status] ?? 0) + 1; if (r.status >= 500) errors++; await r.arrayBuffer(); }
    catch { errors++; codes.network = (codes.network ?? 0) + 1; }
    lat.push(performance.now() - t);
  }
}
const t0 = performance.now();
await Promise.all(Array.from({ length: clients }, worker));
const secs = (performance.now() - t0) / 1000;
lat.sort((a, b) => a - b);
const p = q => lat[Math.min(lat.length - 1, Math.floor(q * lat.length))].toFixed(0);
console.log(`${total} requests, ${clients} clients, ${secs.toFixed(1)}s, ${(total / secs).toFixed(1)} req/s`);
console.log(`latency ms  p50 ${p(0.5)}  p95 ${p(0.95)}  p99 ${p(0.99)}  max ${lat.at(-1).toFixed(0)}`);
console.log(`status codes`, JSON.stringify(codes), `server errors/network failures: ${errors}`);
process.exit(errors / total > 0.01 ? 1 : 0);
