// CI gate: fail on any high/critical production-dependency advisory EXCEPT the ones we have reviewed and accepted below.
// Next.js 14.2.35 is the last 14.x release; the remaining Next advisories are fixed only in 15/16. Each accepted advisory is
// listed with why it does not apply and what mitigates it. Upgrading Next is a tracked launch item (docs/LAUNCH.md).
import { execSync } from "node:child_process";
const ACCEPTED = {
  next: "Image optimiser (disabled: images.unoptimized), rewrites smuggling (no rewrites), RSC deserialisation DoS (no public RSC endpoints beyond our pages; edge proxy/WAF limits request size). Upgrade to Next 15/16 before launch.",
  postcss: "Build-time only (CSS stringify / source maps); no untrusted CSS is processed at runtime.",
  uuid: "Moderate; only v3/v5/v6 with a caller-supplied buffer, which this codebase does not use.",
};
let out;
try { out = execSync("npm audit --omit=dev --json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch (e) { out = e.stdout?.toString() ?? "{}"; }
const vulns = JSON.parse(out).vulnerabilities ?? {};
let bad = 0;
for (const [name, v] of Object.entries(vulns)) {
  const sev = v.severity;
  if (!["high", "critical"].includes(sev)) continue;
  if (ACCEPTED[name]) { console.log(`accepted  ${sev.padEnd(8)} ${name}: ${ACCEPTED[name]}`); continue; }
  console.error(`BLOCKING  ${sev.padEnd(8)} ${name}`); bad++;
}
console.log(bad ? `\n${bad} new high/critical advisory(ies). Fix or review them before merging.` : "\nNo unreviewed high/critical advisories.");
process.exit(bad ? 1 : 0);
