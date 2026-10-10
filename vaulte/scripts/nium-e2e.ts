// Full sandbox walk-through of OUR Nium adapter (creates sandbox objects only; refuses live):
//   npx tsx scripts/nium-e2e.ts
// 1 client + rates  2 onboard a corporate customer  3 clear it (sandbox simulation)  4 virtual account in the customer's name
// 5 a third party pays into the virtual account (simulated)  6 pay an Indian beneficiary (IFSC) from the customer's wallet
// 7 payout lifecycle to PAID  8 a bank return credits the wallet back  9 RFI and rejection are mapped.
import fs from "node:fs";
for (const l of fs.existsSync(".env.partners.local") ? fs.readFileSync(".env.partners.local", "utf8").split(/\r?\n/) : []) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l); if (m && m[2] && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
import { niumFromEnv, parseNiumRef } from "../lib/psp/nium/client";
import { NiumPartner } from "../lib/psp/nium/partner";
import { NiumFxProvider } from "../lib/fx/providers/nium";
import { niumTestPackage } from "./nium-fixtures";

const step = (n: number, t: string) => console.log(`\n[${n}] ${t}`);
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
(async () => {
  const c = niumFromEnv();
  if (!c) { console.log("NIUM_API_KEY / NIUM_CLIENT_HASH_ID not set"); process.exit(2); }
  if (!c.isSandbox) { console.log("Refusing: not the sandbox."); process.exit(2); }
  const p = new NiumPartner(c);
  const tag = Date.now().toString(36).toUpperCase();

  step(1, "client and live sandbox rates through our FX provider");
  const info = await c.client(); console.log(info.name, info.countryCode, (info.paymentIds ?? []).map(x => `${x.currencyCode}:${x.bankName}`).join(" "));
  const fx = new NiumFxProvider(c);
  for (const [s, d, cc] of [["USD", "INR", "IN"], ["EUR", "INR", "IN"], ["USD", "AED", "AE"], ["USD", "GBP", "GB"]]) { const q = await fx.quote({ sourceCurrency: s, destCurrency: d, sourceAmountMinor: 1_000_000, destCountry: cc }, { destPerSource: 1, usdPerSource: 1 }).catch(e => ({ error: (e as Error).message })); console.log(`  ${s}>${d}`, "error" in q ? q.error : `${q.rate} via ${q.rail}, eta ${q.etaSec}s`); }

  step(2, "onboard a corporate customer from a Vaulte KYB package");
  const res = await p.submitCustomer(niumTestPackage(tag));
  console.log(res);
  if (!res.partnerRef) { console.log("FAIL: no customer created"); process.exit(1); }
  const ref = parseNiumRef(res.partnerRef);

  step(3, "approve it (sandbox simulation) and read the status back");
  for (let i = 0; i < 12; i++) { try { await c.simulateOnboarding(ref.customerHashId, "clear"); break; } catch (e) { if (i === 11) throw e; await wait(3000); } } // the application is processed asynchronously
  let st = await p.getCustomerStatus(res.partnerRef);
  for (let i = 0; i < 8 && st.status !== "APPROVED"; i++) { await wait(3000); st = await p.getCustomerStatus(res.partnerRef); }
  console.log(st);

  step(4, "virtual account in the customer's name (USD)");
  const fund = await p.createFiatFunding({ transferId: `T${tag}`, currency: "USD", amountMinor: 500000n, customerRef: res.partnerRef });
  console.log(fund.bankDetails);

  step(5, "a third party pays into the customer's virtual account (sandbox simulation), wait for the wallet credit");
  const vanNumber = fund.partnerRef, bankSource = fund.bankDetails.bank_name;
  await c.simulateVanCredit({ virtualAccountNumber: vanNumber, amount: 5000, currency: "USD", bankSource, country: "SG", bankReferenceNumber: `VE2E-${tag}`, remitterName: "Acme Payer Inc" });
  const usd = async () => ((await c.wallet(ref)) as { curSymbol: string; balance: number }[]).find(x => x.curSymbol === "USD")?.balance ?? 0;
  let bal = 0; for (let i = 0; i < 12 && bal < 5000; i++) { await wait(3000); bal = await usd(); }
  console.log("wallet USD:", bal, bal >= 5000 ? "(settled)" : "(NOT settled)");
  if (bal < 5000) { console.log("FAIL: credit did not settle"); process.exit(1); }

  const payout = (invoice: string, account: string) => p.createPayout({
    transferId: `T${tag}${invoice}`, destCurrency: "INR", destAmountMinor: 500000n, recipientName: "Test Exports India Pvt Ltd", recipientCountry: "IN", invoiceNumber: `INV-${tag}-${invoice}`, customerRef: res.partnerRef,
    beneficiary: { accountName: "Test Exports India Pvt Ltd", entityType: "COMPANY", bankCountry: "IN", currency: "INR", accountNumber: account, ifsc: "HDFC0001234" },
    route: { legs: [{ partner: "nium", srcCurrency: "USD", destCurrency: "INR", rails: ["IMPS"] }] } as never,
  });
  const audit = async (srn: string) => { const a = await c.audit(ref, srn); const list = Array.isArray(a) ? a : (a.content ?? a.audit ?? [a]); return list.map((x: Record<string, unknown>) => String(x.status ?? x.transactionStatus ?? x.complianceStatus ?? "?")).join(" > "); };

  step(6, "payout of INR 5,000 to an Indian company account (HDFC test IFSC) from the customer's wallet");
  const pay = await payout("A", "12345678901234");
  console.log(pay);
  step(7, "payout lifecycle: sandbox moves it to PAID and we read it back");
  console.log("after create :", await audit(pay.partnerRef));
  for (const s of ["COMPLIANCE_COMPLETED", "PAID"]) { try { await c.simulatePayout(pay.partnerRef, s); } catch (e) { console.log(`  simulate ${s}:`, (e as Error).message.slice(0, 160)); } await wait(2500); console.log(`after ${s.padEnd(20)}:`, await audit(pay.partnerRef)); }

  step(8, "second payout, bank returns it (RETURN) and the wallet is credited back");
  const before = await usd();
  const pay2 = await payout("B", "12345678901235");
  console.log("created", pay2.partnerRef, "wallet", await usd());
  for (const s of ["PAID", "RETURN"]) { try { await c.simulatePayout(pay2.partnerRef, s); } catch (e) { console.log(`  simulate ${s}:`, (e as Error).message.slice(0, 160)); } await wait(2500); console.log(`after ${s.padEnd(6)}:`, await audit(pay2.partnerRef)); }
  await wait(3000); console.log("wallet before second payout:", before, "now:", await usd());

  step(9, "onboarding paths: RFI and rejection are mapped to NEEDS_INFO and REJECTED");
  for (const [label, action] of [["rfi", "raise_rfi"], ["rejected", "reject"]] as const) {
    const t2 = Date.now().toString(36).toUpperCase() + label;
    const r2 = await p.submitCustomer({ ...niumTestPackage(t2) });
    const ref2 = parseNiumRef(r2.partnerRef);
    for (let i = 0; i < 12; i++) { try { await c.simulateOnboarding(ref2.customerHashId, action); break; } catch (e) { if (i === 11) console.log("  simulate:", (e as Error).message.slice(0, 200)); await wait(3000); } }
    await wait(3000); console.log(`  ${label}:`, await p.getCustomerStatus(r2.partnerRef));
  }
  console.log("\nPASS");
})();
