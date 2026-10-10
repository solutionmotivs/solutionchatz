// Which Indian real-time rail pays the receiver. All four run 24/7/365, but each has an amount ceiling or floor. The partner enforces the real
// limits (they vary by bank and by payment category); these are planning defaults and can be set per environment. Vaulte never connects to NPCI/RBI
// rails itself: the authorised partner (PA-CB or MTSS) does.
//   UPI   : instant to a UPI ID (VPA); default ceiling INR 1,00,000 (higher for some categories, so partner-confirmed)
//   IMPS  : instant to an account + IFSC; ceiling INR 5,00,000
//   RTGS  : minimum INR 2,00,000, no ceiling
//   NEFT  : any amount, settles in batches (still 24/7)
export interface IndiaRailLimits { upiMax: number; impsMax: number; rtgsMin: number }

export function indiaRailLimits(env: NodeJS.ProcessEnv = process.env): IndiaRailLimits {
  const n = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return { upiMax: n(env.UPI_LIMIT_INR, 100_000), impsMax: n(env.IMPS_LIMIT_INR, 500_000), rtgsMin: n(env.RTGS_MIN_INR, 200_000) };
}

export interface IndiaRailChoice { rail: string; alternatives: string[]; instant: boolean; reason: string }

/** `amountInr` in rupees. `available` = rails the chosen payout partner supports. `hasUpiId` = the receiver gave a UPI ID (undefined = not known yet). */
export function pickIndiaRail(amountInr: number, available: string[], opts: { hasUpiId?: boolean; limits?: IndiaRailLimits } = {}): IndiaRailChoice {
  const L = opts.limits ?? indiaRailLimits();
  const has = (r: string) => available.includes(r);
  const ok: string[] = [];
  if (has("UPI") && opts.hasUpiId && amountInr <= L.upiMax) ok.push("UPI");
  if (has("IMPS") && amountInr <= L.impsMax) ok.push("IMPS");
  if (has("RTGS") && amountInr >= L.rtgsMin) ok.push("RTGS");
  if (has("NEFT")) ok.push("NEFT");
  if (!ok.length) ok.push(...available.filter(r => ["UPI", "IMPS", "RTGS", "NEFT"].includes(r)));
  const rail = ok[0] ?? available[0] ?? "IMPS";
  const instant = rail === "UPI" || rail === "IMPS";
  const reason =
    rail === "UPI" ? "Instant to the receiver's UPI ID."
    : rail === "IMPS" ? `Instant to the bank account${has("UPI") && opts.hasUpiId === false ? " (a UPI ID on file would also work for amounts up to INR " + L.upiMax.toLocaleString("en-IN") + ")" : ""}.`
    : rail === "RTGS" ? `Amount is above the instant-rail limit (INR ${L.impsMax.toLocaleString("en-IN")}); RTGS runs 24/7 and usually settles within the hour.`
    : "NEFT settles in batches, within a few hours.";
  return { rail, alternatives: ok.slice(1), instant, reason };
}

/** A UPI ID (virtual payment address) looks like name@bank. Format check only; the partner verifies the VPA before paying. */
export function validateUpiId(v: string): string | null {
  return /^[A-Za-z0-9.\-_]{2,64}@[A-Za-z][A-Za-z0-9]{1,31}$/.test(v.trim()) ? null : "A UPI ID looks like name@bank";
}
