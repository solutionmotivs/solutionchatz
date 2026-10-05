// Refresh the sanctions lists now (the same call a daily cron makes).
//   BASE_URL=https://app.example.com CRON_SECRET=... node scripts/sanctions-sync.mjs [--force] [--rescreen]
const base = process.env.BASE_URL ?? "http://localhost:3000";
const secret = process.env.CRON_SECRET;
if (!secret) { console.error("CRON_SECRET is required"); process.exit(2); }
const post = async (path) => {
  const r = await fetch(base + path, { method: "POST", headers: { "x-cron-secret": secret } });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const sync = await post("/api/internal/sanctions/sync" + (process.argv.includes("--force") ? "?force=1" : ""));
console.log("sync", sync.status, JSON.stringify(sync.json?.results ?? sync.json, null, 1));
let bad = sync.status !== 200 || (sync.json?.results ?? []).some(r => r.status === "FAILED");
if (process.argv.includes("--rescreen")) {
  const rs = await post("/api/internal/sanctions/rescreen");
  console.log("rescreen", rs.status, JSON.stringify(rs.json));
  bad ||= rs.status !== 200;
}
process.exit(bad ? 1 : 0);
