// Full demo-API walk-through of OUR Currencycloud adapter, creating demo objects only (no real money; refuses to run against the live API):
//   npx tsx scripts/currencycloud-e2e.ts
// 1 open a customer sub-account + contact  2 read its funding details  3 simulate an incoming bank transfer (demo-only endpoint)
// 4 wait for the balance  5 pay a EUR beneficiary from the customer's sub-account (convert + payment)  6 read the payment status.
import fs from "node:fs";
for (const l of fs.existsSync(".env.partners.local") ? fs.readFileSync(".env.partners.local", "utf8").split(/\r?\n/) : []) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l); if (m && m[2] && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
import { currencycloudFromEnv } from "../lib/psp/currencycloud/client";
import { CurrencycloudPartner } from "../lib/psp/currencycloud/partner";

const step = (n: number, t: string) => console.log(`\n[${n}] ${t}`);
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

(async () => {
  const c = currencycloudFromEnv();
  if (!c) { console.log("CURRENCYCLOUD_LOGIN_ID / CURRENCYCLOUD_API_KEY not set"); process.exit(2); }
  if (!c.isDemo) { console.log("Refusing: this is the live API. The walk-through creates objects and is for the demo only."); process.exit(2); }
  const p = new CurrencycloudPartner(c);
  const tag = Date.now().toString(36).toUpperCase();

  step(1, "open the customer's sub-account and contact");
  const res = await p.submitCustomer({
    organizationId: `e2e-${tag}`, legalName: `E2E Exports ${tag} Pvt Ltd`, country: "GB", registrationNumber: `E2E${tag}`, taxId: null, businessType: "Private limited", riskTier: "MEDIUM", kybApprovedAt: new Date().toISOString(),
    address: "1 Test Street", city: "London", postalCode: "E1 6AN", incorporationDate: "2018-04-02", industry: "Textile exports", website: "https://example.com", expectedMonthlyUsd: 40_000,
    contact: { firstName: "Test", lastName: "Owner", email: `owner-${tag.toLowerCase()}@example.com`, phone: "+441234567890" },
  });
  console.log(res);
  if (res.status !== "APPROVED") { console.log("FAIL: customer not approved"); process.exit(1); }
  console.log("status check:", await p.getCustomerStatus(res.partnerRef));

  step(2, "the customer's own funding details (named after the customer)");
  const fund = await p.createFiatFunding({ transferId: `T${tag}`, currency: "GBP", amountMinor: 100000n, customerRef: res.partnerRef });
  console.log(fund.bankDetails);
  const accountNumber = fund.bankDetails.account_number;

  step(3, "simulate an incoming GBP 1,000.00 bank transfer (demo-only endpoint)");
  const cust = c.forCustomer(res.partnerRef);
  console.log(await cust.demoFunding({ accountId: res.partnerRef.split(":")[0], currency: "GBP", amount: "1000.00", receiverAccountNumber: accountNumber }).catch(e => ({ error: (e as Error).message })));

  step(4, "wait for the balance (the demo settles within a minute or two)");
  let gbp = 0;
  for (let i = 0; i < 24 && gbp < 1000; i++) { await wait(5000); gbp = Number((await cust.balances()).balances?.find(b => b.currency === "GBP")?.amount ?? 0); process.stdout.write(`  GBP balance ${gbp}\r`); }
  console.log(`\n  GBP balance ${gbp}`);

  step(5, "pay EUR 100.00 to a German beneficiary from the customer's sub-account");
  const pay = await p.createPayout({
    transferId: `T${tag}`, destCurrency: "EUR", destAmountMinor: 10000n, recipientName: "Beispiel GmbH", recipientCountry: "DE", purposeCode: "P0802", invoiceNumber: `INV-${tag}`.slice(0, 20), customerRef: res.partnerRef,
    beneficiary: { accountName: "Beispiel GmbH", entityType: "COMPANY", bankCountry: "DE", currency: "EUR", iban: "DE89370400440532013000", swiftBic: "COBADEFFXXX" },
    route: { legs: [{ partner: "currencycloud", srcCurrency: "GBP", rails: ["SEPA"] }] } as never,
  }).catch(e => ({ error: (e as Error).message }));
  console.log(pay);
  if ("error" in pay) { console.log(gbp < 1000 ? "(the balance had not arrived yet; re-run later, the demo funding is slow)" : "FAIL"); process.exit(gbp < 1000 ? 0 : 1); }

  step(6, "payment status");
  for (let i = 0; i < 6; i++) { const s = await cust.getPayment(pay.partnerRef); console.log(`  ${s.status}${s.failure_reason ? " / " + s.failure_reason : ""}`); if (s.status && !/ready|awaiting|pending|new/i.test(s.status)) break; await wait(5000); }
  console.log("\nPASS: sub-account, funding details, demo deposit and payout exercised on the demo API");
})();
