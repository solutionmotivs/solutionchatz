// Live smoke test for the Sandbox.co.in KYC adapter. Needs YOUR test keys (this repo's CI has no network access to them).
//   SANDBOX_CO_IN_API_KEY=key_test_... SANDBOX_CO_IN_API_SECRET=secret_test_... node scripts/kyc-smoke.mjs
// Optional: SMOKE_PAN, SMOKE_PAN_NAME, SMOKE_PAN_DOB (DD/MM/YYYY), SMOKE_IFSC, SMOKE_ACCOUNT, SANDBOX_CO_IN_BASE_URL.
// PAN and bank checks are billable on live keys; GSTIN is a public-register lookup.
const base = process.env.SANDBOX_CO_IN_BASE_URL ?? "https://test-api.sandbox.co.in";
const key = process.env.SANDBOX_CO_IN_API_KEY, secret = process.env.SANDBOX_CO_IN_API_SECRET;
if (!key || !secret) { console.error("Set SANDBOX_CO_IN_API_KEY and SANDBOX_CO_IN_API_SECRET"); process.exit(2); }

let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "  ok  " : "  FAIL"} ${name}${cond ? "" : " " + extra}`); if (!cond) failures++; };

const auth = await fetch(`${base}/authenticate`, { method: "POST", headers: { "x-api-key": key, "x-api-secret": secret, "x-api-version": "1.0" } });
const aj = await auth.json().catch(() => ({}));
const token = aj?.data?.access_token;
ok("authenticate returns an access token", auth.status === 200 && !!token, JSON.stringify(aj).slice(0, 200));
if (!token) process.exit(1);
const H = { Authorization: token, "x-api-key": key, "Content-Type": "application/json" };

const g = await fetch(`${base}/gst/compliance/public/gstin/verify`, { method: "POST", headers: H, body: JSON.stringify({ gstin: "24ABKCS2033B1ZV" }) });
const gj = await g.json().catch(() => ({}));
ok("GSTIN verify answers for the documented sample", g.status === 200 && gj?.data?.data?.gstin === "24ABKCS2033B1ZV", JSON.stringify(gj).slice(0, 300));

if (process.env.SMOKE_PAN) {
  const p = await fetch(`${base}/kyc/pan/verify`, { method: "POST", headers: H, body: JSON.stringify({ "@entity": "in.co.sandbox.kyc.pan_verification.request", pan: process.env.SMOKE_PAN, name_as_per_pan: process.env.SMOKE_PAN_NAME, date_of_birth: process.env.SMOKE_PAN_DOB, consent: "Y", reason: "KYC smoke test" }) });
  const pj = await p.json().catch(() => ({}));
  ok("PAN verify answers", p.status === 200 && typeof pj?.data?.status === "string", JSON.stringify(pj).slice(0, 300));
  console.log("       PAN result:", pj?.data?.status, "name match:", pj?.data?.name_as_per_pan_match, "dob match:", pj?.data?.date_of_birth_match);
}
if (process.env.SMOKE_IFSC && process.env.SMOKE_ACCOUNT) {
  const b = await fetch(`${base}/bank/${process.env.SMOKE_IFSC}/accounts/${process.env.SMOKE_ACCOUNT}/verify`, { headers: H });
  const bj = await b.json().catch(() => ({}));
  ok("bank penny-drop answers", b.status === 200 && typeof bj?.data?.account_exists === "boolean", JSON.stringify(bj).slice(0, 300));
}
console.log(failures ? `\n${failures} check(s) failed: tell me the output and I will adjust the adapter.` : "\nAll smoke checks passed.");
process.exit(failures ? 1 : 0);
