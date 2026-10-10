// Check wallet surveillance providers against their LIVE endpoints (no money, no records).
//   node scripts/wallet-check.mjs [address ...]
// Needs only network access for trm_sanctions (free, no key, ~100 checks a day). Set TRM_API_KEY / CHAINALYSIS_API_KEY to try the others.
const addrs = process.argv.slice(2).length ? process.argv.slice(2) : ["149w62rY42aZBox8fGcmqNsXUzSStKeq8C", "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"];
const env = process.env;
const basic = k => `Basic ${Buffer.from(`${k}:${k}`).toString("base64")}`;
for (const a of addrs) {
  const r = await fetch("https://api.trmlabs.com/public/v1/sanctions/screening", { method: "POST", headers: { "content-type": "application/json", ...(env.TRM_API_KEY ? { Authorization: basic(env.TRM_API_KEY) } : {}) }, body: JSON.stringify([{ address: a }]) });
  console.log(`trm_sanctions  ${a}  ${r.status}  ${r.ok ? JSON.stringify((await r.json())[0]) : await r.text()}`);
  if (env.TRM_API_KEY) {
    const v = await fetch("https://api.trmlabs.com/public/v2/screening/addresses", { method: "POST", headers: { "content-type": "application/json", Authorization: basic(env.TRM_API_KEY) }, body: JSON.stringify([{ address: a, chain: a.startsWith("0x") ? "ethereum" : "bitcoin" }]) });
    console.log(`trm_risk       ${a}  ${v.status}  ${(await v.text()).slice(0, 400)}`);
  }
  if (env.CHAINALYSIS_API_KEY) {
    const c = await fetch(`https://public.chainalysis.com/api/v1/address/${a}`, { headers: { "X-API-Key": env.CHAINALYSIS_API_KEY, Accept: "application/json" } });
    console.log(`chainalysis    ${a}  ${c.status}  ${(await c.text()).slice(0, 300)}`);
  }
}
