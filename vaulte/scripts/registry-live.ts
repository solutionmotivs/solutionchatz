// Live check of the keyless national registers: npx tsx scripts/registry-live.ts   (needs internet; no keys)
import { defaultAdapters } from "../lib/kyc/registries/adapters";
const cases: [string, string, string][] = [["FR", "REG_NO", "552032534"], ["NO", "REG_NO", "923609016"], ["CZ", "REG_NO", "00006947"], ["SG", "REG_NO", "198600294G"], ["EE", "REG_NO", "11120894"], ["FR", "REG_NO", "999999999"]];
(async () => {
  let bad = 0;
  for (const [c, code, v] of cases) {
    const a = defaultAdapters().find(x => x.supports(code as any, c))!;
    const r = await a.lookup(code as any, v, c);
    console.log(c, v, r.status, r.legalName ?? r.reason ?? "", r.active);
    if (v === "999999999" ? r.status !== "NOT_FOUND" : r.status !== "FOUND") bad++;
  }
  process.exit(bad ? 1 : 0);
})();
