// Screening service: loads the mirrored lists into an in-memory index, screens names and wallets, records every check.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { SanctionsIndex, decide, type IndexEntry, type Match, type Outcome, type Query } from "./match";
import { canonical, normTokens } from "./normalize";

let cache: { index: SanctionsIndex; versions: Record<string, string>; loadedAt: number; fingerprint: string } | null = null;
const MAX_AGE_MS = 60_000;

export function invalidateIndex() { cache = null; }

async function fingerprint() {
  const lists = await db.sanctionsList.findMany({ where: { status: "OK" }, select: { code: true, version: true, fetchedAt: true } });
  return { lists, key: lists.map(l => `${l.code}:${l.version}:${l.fetchedAt.getTime()}`).sort().join("|") };
}

export async function getIndex() {
  if (cache && Date.now() - cache.loadedAt < MAX_AGE_MS) return cache;
  const fp = await fingerprint();
  if (cache && cache.fingerprint === fp.key) { cache.loadedAt = Date.now(); return cache; }
  const rows = await db.sanctionsEntry.findMany({ where: { list: { in: fp.lists.map(l => l.code) } } });
  const entries: IndexEntry[] = rows.map(r => {
    const kind = r.kind === "INDIVIDUAL" ? "INDIVIDUAL" : "ENTITY";
    const variants = Array.from(new Set([r.name, ...r.aliases])).map(text => ({ text, tokens: normTokens(text, kind), canon: canonical(text, kind) })).filter(v => v.tokens.length);
    return { id: r.id, list: r.list, externalId: r.externalId, kind: r.kind, name: r.name, variants, birthYears: r.birthYears, countries: r.countries, programs: r.programs };
  });
  cache = { index: new SanctionsIndex(entries), versions: Object.fromEntries(fp.lists.map(l => [l.code, l.version ?? ""])), loadedAt: Date.now(), fingerprint: fp.key };
  return cache;
}

export interface Ctx {
  organizationId?: string;
  subjectType: "CASE_SUBJECT" | "CASE_PERSON" | "ENTITY" | "TRANSFER_PARTY" | "WALLET" | "VA_PAYER" | "RESCREEN";
  subjectId?: string;
}

export interface ScreenResult {
  outcome: Outcome;
  topScore: number;
  matches: Match[];
  checkId: string;
  listsLoaded: boolean;
  /** Lists older than 48 hours: screening still runs but operations should be alerted. */
  stale: boolean;
  note?: string;
}

function countryName(iso?: string) {
  if (!iso) return undefined;
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(iso.toUpperCase())?.toLowerCase(); } catch { return undefined; }
}

async function record(ctx: Ctx, query: Prisma.InputJsonValue, outcome: Outcome, top: number, matches: unknown, versions: Record<string, string>, note?: string) {
  // Re-screening the same party for the same name must not pile up duplicate alerts: reuse the open one.
  if (outcome !== "CLEAR" && ctx.subjectId) {
    const name = (query as { name?: string; address?: string }).name ?? (query as { address?: string }).address;
    const open = await db.screeningCheck.findMany({ where: { subjectId: ctx.subjectId, status: "OPEN" }, select: { id: true, query: true, result: true } });
    const dup = open.find(o => ((o.query as { name?: string; address?: string }).name ?? (o.query as { address?: string }).address) === name && (o.result === outcome || outcome === "REVIEW"));
    if (dup) return dup.id;
    // A stronger result than the open alert replaces it.
  }
  const row = await db.screeningCheck.create({
    data: {
      organizationId: ctx.organizationId ?? null, subjectType: ctx.subjectType, subjectId: ctx.subjectId ?? null, query, result: outcome, topScore: top,
      matches: (matches ?? []) as Prisma.InputJsonValue, listVersions: versions, status: outcome === "CLEAR" ? null : "OPEN", note: note ?? null,
    },
  });
  return row.id;
}

export async function screenName(q: Query, ctx: Ctx): Promise<ScreenResult> {
  const { index, versions } = await getIndex();
  const listsLoaded = index.entries.length > 0;
  const oldest = await db.sanctionsList.findFirst({ where: { status: "OK" }, orderBy: { fetchedAt: "asc" }, select: { fetchedAt: true } });
  const stale = !oldest || Date.now() - oldest.fetchedAt.getTime() > 48 * 3600_000;
  const query = { name: q.name, kind: q.kind ?? "ENTITY", country: q.country ?? null, dob: q.dateOfBirth ?? null };

  if (!listsLoaded) {
    // Fail closed in production: with no lists we cannot say anyone is clear.
    if (process.env.NODE_ENV === "production") {
      const id = await record(ctx, query, "REVIEW", 0, [], versions, "LISTS_NOT_LOADED");
      return { outcome: "REVIEW", topScore: 0, matches: [], checkId: id, listsLoaded, stale: true, note: "Sanctions lists are not loaded" };
    }
    const id = await record(ctx, query, "CLEAR", 0, [], versions, "LISTS_NOT_LOADED_DEV");
    return { outcome: "CLEAR", topScore: 0, matches: [], checkId: id, listsLoaded, stale, note: "No lists loaded (development)" };
  }

  const matches = index.search({ ...q, country: countryName(q.country) ?? q.country });
  let { outcome, top } = decide(matches, q);
  let note: string | undefined;

  // A reviewer already cleared exactly these matches for this subject as false positives: do not raise the same alert again.
  if (outcome !== "CLEAR" && ctx.subjectId) {
    const cleared = await db.screeningCheck.findMany({ where: { subjectId: ctx.subjectId, status: "CLEARED" }, select: { matches: true, query: true } });
    const clearedIds = new Set(cleared.filter(c => (c.query as { name?: string }).name === q.name).flatMap(c => ((c.matches as unknown as Match[]) ?? []).map(m => m.entryId)));
    const relevant = matches.filter(m => m.score >= (process.env.SANCTIONS_REVIEW_SCORE ? Number(process.env.SANCTIONS_REVIEW_SCORE) : 88));
    if (relevant.length && relevant.every(m => clearedIds.has(m.entryId))) { outcome = "CLEAR"; note = "PREVIOUSLY_CLEARED_FALSE_POSITIVE"; }
  }
  const id = await record(ctx, query, outcome, top, matches, versions, note);
  return { outcome, topScore: top, matches, checkId: id, listsLoaded, stale, note };
}

export interface WalletResult { outcome: "CLEAR" | "REVIEW" | "BLOCK"; checkId: string; matches: { list: string; asset: string; listedName: string; programs: string[] }[]; source: string[] }

export async function screenWalletAddress(address: string, ctx: Ctx & { chain?: string }): Promise<WalletResult> {
  const { addressKey } = await import("./sync");
  const key = addressKey(address);
  const hits = await db.sanctionsAddress.findMany({ where: { addrKey: key }, include: { entry: { select: { name: true, programs: true } } }, take: 10 });
  const matches: { list: string; asset: string; listedName: string; programs: string[] }[] = hits.map(h => ({ list: h.list, asset: h.asset, listedName: h.entry.name, programs: h.entry.programs }));
  const source = ["lists"];
  let outcome: "CLEAR" | "REVIEW" | "BLOCK" = matches.length ? "BLOCK" : "CLEAR";
  // Analytics providers (lib/surveillance): sanctions exposure blocks, high risk or an outage goes to review. A list hit is final either way.
  const { runSurveillance } = await import("@/lib/surveillance");
  const live = await runSurveillance(address, { chain: ctx.chain });
  for (const v of live.verdicts) {
    source.push(v.provider);
    if (v.sanctioned || v.risk !== "NONE") matches.push({ list: v.provider, asset: v.risk, listedName: v.detail || v.categories.join(", "), programs: v.categories });
  }
  for (const f of live.failed) source.push(`${f.provider}:error`);
  if (outcome !== "BLOCK" && live.outcome !== "CLEAR") outcome = live.outcome;
  const { versions } = await getIndex();
  const checkId = await record(ctx, { address: key }, outcome, outcome === "BLOCK" ? 100 : outcome === "REVIEW" ? 70 : 0, matches, versions, live.note);
  return { outcome, checkId, matches, source };
}
