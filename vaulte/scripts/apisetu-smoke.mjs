// Read-only smoke test for API Setu KYC services with YOUR registered credentials. Sends only synthetic data; CKYC lookup and OTP download are NOT called.
//   APISETU_CLIENT_ID=... APISETU_API_KEY=... node scripts/apisetu-smoke.mjs
// If a path differs from the default, set APISETU_PATH_CKYC_SEARCH / _AMLPEP / _OCR / _OCR_QUALITY (see lib/kyc/providers/apisetu/client.ts).
const base = (process.env.APISETU_BASE_URL ?? "https://apisetu.gov.in").replace(/\/$/, "");
const paths = { amlPep: process.env.APISETU_PATH_AMLPEP ?? "/amlpep/v1/verify", ocrQuality: process.env.APISETU_PATH_OCR_QUALITY ?? "/kycocr/v1/quality" };
const h = { "content-type": "application/json", "X-APISETU-CLIENTID": process.env.APISETU_CLIENT_ID ?? "", "X-APISETU-APIKEY": process.env.APISETU_API_KEY ?? "" };
const ok = (n, pass, x = "") => { console.log(`${pass ? "PASS" : "FAIL"}  ${n}  ${x}`); if (!pass) process.exitCode = 1; };
if (!process.env.APISETU_CLIENT_ID || !process.env.APISETU_API_KEY) { console.log("set APISETU_CLIENT_ID and APISETU_API_KEY"); process.exit(2); }
const call = async (p, body) => { const r = await fetch(base + p, { method: "POST", headers: h, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, json: j }; };
const a = await call(paths.amlPep, { name: "Test Person", country: "IN", entity_type: "INDIVIDUAL" });
ok("AML/PEP endpoint answers (auth accepted)", a.status === 200, `HTTP ${a.status} ${JSON.stringify(a.json)?.slice(0, 160)}`);
const q = await call(paths.ocrQuality, { document_type: "PAN_CARD", mime_type: "image/png", image_base64: "iVBORw0KGgo=" });
ok("OCR quality endpoint answers (a 4xx about the image is fine; 401/403/404 is not)", q.status === 200 || q.status === 400 || q.status === 422, `HTTP ${q.status} ${JSON.stringify(q.json)?.slice(0, 160)}`);
