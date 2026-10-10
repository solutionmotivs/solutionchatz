// Sandbox check of OUR Cashfree Payouts adapter (sandbox only; refuses production):
//   npx tsx scripts/cashfree-e2e.ts
// 1 keys + IP whitelist / signature  3 IMPS payout to a test bank account  4 poll to a final status  5 UPI payout  6 a bad IFSC is refused.
// Needs CASHFREE_CLIENT_ID / CASHFREE_CLIENT_SECRET (sandbox) and EITHER the calling IP whitelisted in the Cashfree dashboard
// OR CASHFREE_PUBLIC_KEY (Developers > Two-Factor Authentication > Public Key, PEM) so requests carry x-cf-signature.
import fs from "node:fs";
for (const l of fs.existsSync(".env.partners.local") ? fs.readFileSync(".env.partners.local", "utf8").split(/\r?\n/) : []) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l); if (m && m[2] && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
if (!process.env.CASHFREE_PUBLIC_KEY && process.env.CASHFREE_PUBLIC_KEY_FILE && fs.existsSync(process.env.CASHFREE_PUBLIC_KEY_FILE)) process.env.CASHFREE_PUBLIC_KEY = fs.readFileSync(process.env.CASHFREE_PUBLIC_KEY_FILE, "utf8");
import { cashfreeFromEnv } from "../lib/psp/cashfree/client";
import { CashfreePartner } from "../lib/psp/cashfree/partner";

const step = (n: number, t: string) => console.log(`\n[${n}] ${t}`);
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
(async () => {
  const c = cashfreeFromEnv();
  if (!c) { console.log("CASHFREE_CLIENT_ID / CASHFREE_CLIENT_SECRET not set"); process.exit(2); }
  if (!c.isSandbox) { console.log("Refusing: not the sandbox."); process.exit(2); }
  const p = new CashfreePartner(c);
  const tag = Date.now().toString(36);
  let failed = 0;
  const check = (ok: boolean, what: string) => { console.log(`  ${ok ? "PASS" : "FAIL"} ${what}`); if (!ok) failed++; };

  step(1, `credentials (${c.signs ? "signed requests" : "no signature: this IP must be whitelisted"})`);
  try { check(await c.ping(), "keys accepted"); } catch (e) {
    console.log("  " + msg(e));
    if (/IP not whitelisted/i.test(msg(e))) console.log("  -> Cashfree dashboard > Developers > Payouts > Two-Factor Authentication: download the Public Key (PEM) into CASHFREE_PUBLIC_KEY_FILE, or whitelist this server's IP.");
    process.exit(1);
  }

  const base = { route: { legs: [] } as never, destCurrency: "INR", recipientName: "Sandbox Receiver", recipientCountry: "IN" };
  step(3, "IMPS payout to Cashfree's sandbox test bank account");
  const id1 = `vlt_${tag}_a`;
  let ref: string | undefined;
  try {
    const r = await p.createPayout({ ...base, transferId: id1, destAmountMinor: 150_000n, rail: "IMPS", invoiceNumber: "INV-1", beneficiary: { accountName: "Sandbox Receiver", entityType: "PERSONAL", bankCountry: "IN", currency: "INR", accountNumber: "026291800001191", ifsc: "YESB0000262" } });
    ref = r.partnerRef; check(ref === id1, `accepted, partnerRef = our transfer id (${ref})`);
  } catch (e) { check(false, "payout accepted: " + msg(e)); }

  step(4, "poll until a final status (sandbox settles in seconds to a minute or two)");
  if (ref) {
    let last = "PENDING";
    for (let i = 0; i < 24 && last === "PENDING"; i++) { await wait(5000); const st = await p.getPayoutStatus(ref).catch(e => ({ state: "PENDING" as const, reason: msg(e) })); last = st.state; process.stdout.write(`  ${st.state}${st.reason ? " (" + st.reason + ")" : ""}\n`); }
    check(last !== "PENDING", `reached a final state: ${last}`);
  }

  step(5, "UPI payout");
  try {
    const r = await p.createPayout({ ...base, transferId: `vlt_${tag}_b`, destAmountMinor: 100_00n, rail: "UPI", beneficiary: { accountName: "Sandbox Receiver", entityType: "PERSONAL", bankCountry: "IN", currency: "INR", upiId: "success@upi" } });
    check(!!r.partnerRef, "UPI payout accepted (" + r.partnerRef + ")");
  } catch (e) { check(false, "UPI payout: " + msg(e)); }

  step(6, "a malformed IFSC is refused by Cashfree (and we do not retry it)");
  try { await p.createPayout({ ...base, transferId: `vlt_${tag}_c`, destAmountMinor: 100_00n, rail: "IMPS", beneficiary: { accountName: "X Y", entityType: "PERSONAL", bankCountry: "IN", currency: "INR", accountNumber: "026291800001191", ifsc: "BAD" } }); check(false, "bad IFSC should be refused"); }
  catch (e) { check(true, "refused: " + msg(e).slice(0, 140)); }

  console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(msg(e)); process.exit(1); });
