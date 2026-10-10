// Measured settlement times: funds confirmed by the partner -> payout completed, per corridor, from our own completed transfers.
// This is the number we publish. Typical/target times from the catalogue are only shown when there are too few samples.
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/sender";
import type { MeasuredTiming } from "./timing";

export const MIN_SAMPLES = 5;
const WINDOW_DAYS = 30;

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function summarise(durationsSec: number[]): MeasuredTiming | null {
  if (durationsSec.length < MIN_SAMPLES) return null;
  const s = [...durationsSec].sort((a, b) => a - b);
  return { samples: s.length, p50_seconds: Math.round(percentile(s, 50)), p90_seconds: Math.round(percentile(s, 90)) };
}

const cache = new Map<string, { at: number; v: MeasuredTiming | null }>();
export const clearMetricsCache = () => cache.clear();

/** Sandbox transfers do not count toward published live timings; test mode reports its own (simulated) numbers separately. */
export async function corridorTiming(origin: string, dest: string, sandbox: boolean, now = Date.now()): Promise<MeasuredTiming | null> {
  const key = `${origin}>${dest}:${sandbox}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < 5 * 60_000) return hit.v;
  const rows = await db.transfer.findMany({
    where: { originCountry: origin, destCountry: dest, isSandbox: sandbox, status: "COMPLETED", fundedAt: { not: null }, completedAt: { gte: new Date(now - WINDOW_DAYS * 86_400_000) } },
    select: { fundedAt: true, completedAt: true }, take: 2000, orderBy: { completedAt: "desc" },
  });
  const v = summarise(rows.map(r => (r.completedAt!.getTime() - r.fundedAt!.getTime()) / 1000).filter(x => x >= 0));
  cache.set(key, { at: now, v });
  return v;
}

export interface CorridorRow { origin: string; dest: string; sandbox: boolean; samples: number; p50_seconds: number | null; p90_seconds: number | null; same_day_pct: number | null }

/** Staff view: every corridor with completed transfers in the last 30 days. */
export async function settlementReport(now = Date.now()): Promise<CorridorRow[]> {
  const rows = await db.transfer.findMany({
    where: { status: "COMPLETED", fundedAt: { not: null }, completedAt: { gte: new Date(now - WINDOW_DAYS * 86_400_000) } },
    select: { originCountry: true, destCountry: true, isSandbox: true, fundedAt: true, completedAt: true }, take: 20_000,
  });
  const groups = new Map<string, { origin: string; dest: string; sandbox: boolean; d: number[]; sameDay: number }>();
  for (const r of rows) {
    const k = `${r.originCountry}>${r.destCountry}:${r.isSandbox}`;
    const g = groups.get(k) ?? { origin: r.originCountry, dest: r.destCountry, sandbox: r.isSandbox, d: [], sameDay: 0 };
    const sec = (r.completedAt!.getTime() - r.fundedAt!.getTime()) / 1000;
    g.d.push(sec); if (r.fundedAt!.toISOString().slice(0, 10) === r.completedAt!.toISOString().slice(0, 10)) g.sameDay++;
    groups.set(k, g);
  }
  return [...groups.values()].map(g => {
    const s = [...g.d].sort((a, b) => a - b);
    return { origin: g.origin, dest: g.dest, sandbox: g.sandbox, samples: s.length, p50_seconds: Math.round(percentile(s, 50)), p90_seconds: Math.round(percentile(s, 90)), same_day_pct: Math.round((g.sameDay / s.length) * 100) };
  }).sort((a, b) => b.samples - a.samples);
}

/**
 * Slow-transfer watchdog: transfers still in flight well past the time we quoted. Flags each transfer once (audit entry) and emails ops.
 * Threshold: 2x the quoted ETA, at least 15 minutes. Transfers waiting for the sender's funds are not slow (they are not ours to speed up).
 */
export async function runSlowTransferWatchdog(now = Date.now()): Promise<{ flagged: string[] }> {
  const inflight = await db.transfer.findMany({ where: { status: { in: ["FUNDS_DETECTED", "PAYING_OUT"] }, fundedAt: { not: null } }, select: { id: true, organizationId: true, fundedAt: true, route: true, originCountry: true, destCountry: true, status: true }, take: 500 });
  const flagged: string[] = [];
  for (const t of inflight) {
    const eta = Number((t.route as { etaSec?: number } | null)?.etaSec ?? 0);
    const limitMs = Math.max(eta * 2, 15 * 60) * 1000;
    if (now - t.fundedAt!.getTime() < limitMs) continue;
    const already = await db.auditLog.count({ where: { action: "transfer.slow", resourceId: t.id } });
    if (already) continue;
    await db.auditLog.create({ data: { action: "transfer.slow", resourceType: "Transfer", resourceId: t.id, organizationId: t.organizationId, metadata: { status: t.status, quoted_eta_seconds: eta, waiting_seconds: Math.round((now - t.fundedAt!.getTime()) / 1000), corridor: `${t.originCountry}>${t.destCountry}` } } });
    flagged.push(t.id);
  }
  if (flagged.length && process.env.OPS_EMAIL) {
    const text = `${flagged.length} transfer(s) are past twice their quoted arrival time and still in flight:\n${flagged.map(i => `- ${i}`).join("\n")}\n\nCheck with the payout partner. Customers are not notified automatically.`;
    await sendEmail({ to: process.env.OPS_EMAIL, template: { subject: `${flagged.length} slow transfer(s)`, text, html: `<p style="font-family:sans-serif;font-size:14px">${text.replace(/\n/g, "<br>")}</p>` } }).catch(() => {});
  }
  return { flagged };
}
