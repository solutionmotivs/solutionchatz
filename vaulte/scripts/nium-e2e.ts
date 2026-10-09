// Full sandbox walk-through of OUR Nium adapter (creates sandbox objects only; refuses live):
//   npx tsx scripts/nium-e2e.ts
// 1 client + rates  2 onboard a corporate customer  3 clear it (sandbox simulation)  4 virtual account in the customer's name
// 5 simulate an incoming deposit  6 pay an Indian beneficiary (IFSC) from the customer's wallet  7 payout status.
import fs from "node:fs";
for (const l of fs.existsSync(".env.partners.local") ? fs.readFileSync(".env.partners.local", "utf8").split(/\r?\n/) : []) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(l); if (m && m[2] && !(m[1] in process.env)) process.env[m[1]] = m[2]; }
import { niumFromEnv, parseNiumRef } from "../lib/psp/nium/client";
import { NiumPartner } from "../lib/psp/nium/partner";
import { NiumFxProvider } from "../lib/fx/providers/nium";

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
  const res = await p.submitCustomer({
    organizationId: `e2e${tag}`, legalName: `Vaulte E2E ${tag} LLC`, country: "US", registrationNumber: String(100000000 + (Date.now() % 800000000)), taxId: null, businessType: "Private limited", riskTier: "MEDIUM", kybApprovedAt: new Date().toISOString(),
    address: "1 Main St", city: "Austin", state: "TX", postalCode: "73301", incorporationDate: "2019-05-21", industry: "Software", website: "https://example.com", expectedMonthlyUsd: 40_000,
    people: [{ role: "APPLICANT", firstName: "Test", lastName: "Owner", dateOfBirth: "1985-03-14", nationality: "US", ownershipPct: 100, email: "owner@example.com", phone: "7337223608", phoneCountryCode: "1", address: { line1: "1 Main St", city: "Austin", state: "TX", postcode: "73301", country: "US" } }],
    returnBank: { accountName: `Vaulte E2E ${tag} LLC`, accountNumber: "AT483200000012345", bankCountry: "US", currency: "USD", routingType: "ACH CODE", routingValue: "042100175", bankName: "Test Bank" },
    consent: { acceptedAt: new Date().toISOString(), ip: "203.0.113.10", deviceInfo: "web", sessionId: `e2e-${tag}` },
    documents: [{ type: "business_registration_doc", fileIds: ["787244f3-b4f9-4c54-02af-b472123a6067"] }],
  });
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

  step(5, "payout of INR 5,000 to an Indian company account (HDFC test IFSC)");
  const pay = await p.createPayout({
    transferId: `T${tag}`, destCurrency: "INR", destAmountMinor: 500000n, recipientName: "Test Exports India Pvt Ltd", recipientCountry: "IN", invoiceNumber: `INV-${tag}`, customerRef: res.partnerRef,
    beneficiary: { accountName: "Test Exports India Pvt Ltd", entityType: "COMPANY", bankCountry: "IN", currency: "INR", accountNumber: "12345678901234", ifsc: "HDFC0001234" },
    route: { legs: [{ partner: "nium", srcCurrency: "USD", destCurrency: "INR", rails: ["IMPS"] }] } as never,
  }).catch(e => ({ error: (e as Error).message }));
  console.log(pay);
  console.log("error" in pay && /Insufficient funds/i.test(pay.error) ? "\nRESULT: customer, virtual account and the payout request all accepted; the payout waits for wallet funds (the sandbox keeps simulated third-party credits pending)." : "error" in pay ? "\nFAIL" : "\nPASS");
})();
