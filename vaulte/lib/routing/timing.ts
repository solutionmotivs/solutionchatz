// Settlement timing: typical partner time + waiting for banking hours/cut-offs on rails that are not always on.
// Everything here is an ESTIMATE for display and route ranking. Real timing comes from the partner, the rails and compliance holds;
// the measured numbers in lib/routing/settlement-metrics.ts are what we publish, not these.
import type { Route } from "@/lib/stablecoin/types";
import { RAILS } from "./rails";

export interface RailWindow { tz: string; openHour: number; closeHour: number; country: string }
/** Approximate banking windows (local time, Mon-Fri) for rails that do not run 24/7. Partners publish the real cut-offs. */
export const RAIL_WINDOWS: Record<string, RailWindow> = {
  SWIFT: { tz: "Europe/London", openHour: 8, closeHour: 16, country: "GB" },
  SWIFT_SAMEDAY: { tz: "Europe/London", openHour: 7, closeHour: 13, country: "GB" },
  SEPA: { tz: "Europe/Berlin", openHour: 7, closeHour: 15, country: "DE" },
  ACH: { tz: "America/New_York", openHour: 8, closeHour: 14, country: "US" },
  ACH_SAME_DAY: { tz: "America/New_York", openHour: 8, closeHour: 14, country: "US" },
  FEDWIRE: { tz: "America/New_York", openHour: 9, closeHour: 18, country: "US" },
  EFT_CA: { tz: "America/Toronto", openHour: 8, closeHour: 16, country: "CA" },
  UAEFTS: { tz: "Asia/Dubai", openHour: 8, closeHour: 15, country: "AE" },
};

const COUNTRY_TZ: Record<string, string> = {
  US: "America/New_York", CA: "America/Toronto", GB: "Europe/London", DE: "Europe/Berlin", FR: "Europe/Paris", NL: "Europe/Amsterdam", IT: "Europe/Rome", ES: "Europe/Madrid",
  AE: "Asia/Dubai", SA: "Asia/Riyadh", IN: "Asia/Kolkata", NP: "Asia/Kathmandu", SG: "Asia/Singapore", MY: "Asia/Kuala_Lumpur", AU: "Australia/Sydney",
  JP: "Asia/Tokyo", CN: "Asia/Shanghai", HK: "Asia/Hong_Kong",
};
export const tzFor = (country: string) => COUNTRY_TZ[country.toUpperCase()] ?? "UTC";

interface Local { date: string; hour: number; weekday: number }
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function local(t: number, tz: string): Local {
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }); fmtCache.set(tz, f); }
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}

/** Public holidays as ISO dates per country, from env BANK_HOLIDAYS_<CC>=2026-12-25,2026-12-28. Empty by default (no invented data). */
export function holidaysFor(country: string, env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set((env[`BANK_HOLIDAYS_${country.toUpperCase()}`] ?? "").split(",").map(s => s.trim()).filter(Boolean));
}

function isOpen(t: number, w: RailWindow, env: NodeJS.ProcessEnv): boolean {
  const l = local(t, w.tz);
  return l.weekday >= 1 && l.weekday <= 5 && l.hour >= w.openHour && l.hour < w.closeHour && !holidaysFor(w.country, env).has(l.date);
}

/** Seconds from `now` until the rail's window is open (0 when always-on, unknown, or open now). */
export function waitForRailSec(rail: string, now: number, env: NodeJS.ProcessEnv = process.env): number {
  if (RAILS[rail]?.alwaysOn) return 0;
  const w = RAIL_WINDOWS[rail];
  if (!w || isOpen(now, w, env)) return 0;
  for (let step = 1; step <= 14 * 24 * 4; step++) { // 15-minute steps, up to two weeks ahead
    const t = now + step * 15 * 60_000;
    if (isOpen(t, w, env)) return Math.round((t - now) / 1000);
  }
  return 14 * 24 * 3600;
}

/** Effective time for a route started at `now`: each leg's typical time plus any wait for banking hours, evaluated at the moment that leg starts. */
export function effectiveEtaSec(route: Route, now = Date.now(), env: NodeJS.ProcessEnv = process.env): { seconds: number; waitsForBanking: boolean } {
  let t = now; let waits = false;
  for (const leg of route.legs) {
    const rails = leg.rails.length ? leg.rails : ["SWIFT"];
    const wait = Math.min(...rails.map(r => waitForRailSec(r, t, env)));
    if (wait > 0) waits = true;
    t += (wait + leg.etaSec) * 1000;
  }
  const chainEta = route.etaSec - route.legs.reduce((s, l) => s + l.etaSec, 0); // on-chain confirmation time
  t += Math.max(chainEta, 0) * 1000;
  return { seconds: Math.round((t - now) / 1000), waitsForBanking: waits };
}

/** True when the money lands before the end of today's calendar date in the destination country. */
export function landsSameDay(effectiveSec: number, destCountry: string, now = Date.now()): boolean {
  const tz = tzFor(destCountry);
  return local(now, tz).date === local(now + effectiveSec * 1000, tz).date;
}

export interface MeasuredTiming { samples: number; p50_seconds: number; p90_seconds: number }
export interface Timing {
  typical_seconds: number;
  effective_seconds: number;
  same_day: boolean;
  within_24h: boolean;
  waits_for_banking_hours: boolean;
  basis: "measured" | "target";
  measured: MeasuredTiming | null;
  note: string;
}

export function buildTiming(route: Route, destCountry: string, measured: MeasuredTiming | null, now = Date.now(), env: NodeJS.ProcessEnv = process.env): Timing {
  const eff = effectiveEtaSec(route, now, env);
  const basis = measured ? "measured" : "target";
  return {
    typical_seconds: route.etaSec,
    effective_seconds: eff.seconds,
    same_day: landsSameDay(eff.seconds, destCountry, now),
    within_24h: eff.seconds <= 24 * 3600,
    waits_for_banking_hours: eff.waitsForBanking,
    basis,
    measured,
    note: measured
      ? `Measured on ${measured.samples} completed transfers in this corridor over the last 30 days: half arrive within ${fmtDur(measured.p50_seconds)}, nine in ten within ${fmtDur(measured.p90_seconds)}, counted from when the partner confirmed your funds.`
      : "A target, not a guarantee: too few completed transfers in this corridor to publish a measured time. Actual time depends on the partners, bank cut-offs and any compliance review.",
  };
}

export const fmtDur = (s: number) => (s < 90 ? `${Math.round(s)} seconds` : s < 5400 ? `${Math.round(s / 60)} minutes` : `${Math.round(s / 360) / 10} hours`);
