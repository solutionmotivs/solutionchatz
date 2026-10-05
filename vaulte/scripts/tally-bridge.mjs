// Tally bridge: runs on the computer that runs Tally (Tally listens on http://localhost:9000 when its XML server is enabled:
// F1 Help > Settings > Connectivity > "Tally.ERP 9 is acting as: Server", port 9000). Tally has no webhooks, so this
// polls Vaulte for new completed transfers, imports them as vouchers, and tells Vaulte what succeeded.
//
//   VAULTE_URL=https://app.example.com VAULTE_API_KEY=vlt_live_... node scripts/tally-bridge.mjs [--once]
//   Optional: TALLY_URL=http://localhost:9000  POLL_SECONDS=300
//
// First connect Tally in the dashboard (Integrations > Tally) and set the bank ledger name, charges ledger and company.
const vaulte = (process.env.VAULTE_URL ?? "").replace(/\/$/, "");
const key = process.env.VAULTE_API_KEY;
const tally = process.env.TALLY_URL ?? "http://localhost:9000";
if (!vaulte || !key) { console.error("Set VAULTE_URL and VAULTE_API_KEY"); process.exit(2); }
const H = { Authorization: `Bearer ${key}` };

async function once() {
  const r = await fetch(`${vaulte}/api/exports/tally?pending=1&limit=100`, { headers: H });
  if (r.status === 204) return { imported: 0 };
  if (!r.ok) throw new Error(`Vaulte answered ${r.status}`);
  const ids = (r.headers.get("x-vaulte-transfer-ids") ?? "").split(",").filter(Boolean);
  const skipped = (r.headers.get("x-vaulte-skipped-currency-mismatch") ?? "").split(",").filter(Boolean);
  const xml = await r.text();
  if (skipped.length) await ack(skipped, "SKIPPED", `Currency differs from your Tally base currency (${r.headers.get("x-vaulte-base-currency")}); export via CSV instead`);
  if (!ids.length) return { imported: 0, skipped: skipped.length };
  let res; try { res = await fetch(tally, { method: "POST", headers: { "Content-Type": "text/xml" }, body: xml }); } catch (e) { await ack(ids, "FAILED", `Tally not reachable at ${tally}`); throw e; }
  const reply = await res.text();
  // Tally answers <IMPORTRESULT><CREATED>n</CREATED><ALTERED/><ERRORS>n</ERRORS>... Master "already exists" errors are expected on later runs.
  const created = Number(/<CREATED>(\d+)<\/CREATED>/.exec(reply)?.[1] ?? 0), errors = Number(/<ERRORS>(\d+)<\/ERRORS>/.exec(reply)?.[1] ?? 0);
  const lineErr = /<LINEERROR>([^<]*)<\/LINEERROR>/.exec(reply)?.[1];
  const mastersAndVouchers = created >= ids.length;
  await ack(ids, mastersAndVouchers ? "SYNCED" : "FAILED", mastersAndVouchers ? undefined : `Tally created ${created}, errors ${errors}${lineErr ? `: ${lineErr}` : ""}`);
  return { imported: mastersAndVouchers ? ids.length : 0, tallyReply: reply.slice(0, 300) };
}
async function ack(ids, status, error) {
  await fetch(`${vaulte}/api/exports/ack`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ provider: "TALLY", transfer_ids: ids, status, error }) });
}
const loop = !process.argv.includes("--once");
do {
  try { console.log(new Date().toISOString(), JSON.stringify(await once())); } catch (e) { console.error(new Date().toISOString(), "error:", e.message); }
  if (loop) await new Promise(r => setTimeout(r, Number(process.env.POLL_SECONDS ?? 300) * 1000));
} while (loop);
