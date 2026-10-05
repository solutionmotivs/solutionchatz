// Downloads the official lists and mirrors them into the database. Run daily (cron) via /api/internal/sanctions/sync.
// A failed or suspiciously small download never replaces a good list.
import { createHash, randomUUID } from "crypto";
import { db } from "@/lib/db";
import { canonical, normalizeName } from "./normalize";
import { parseOfac, parseUk, parseUn, type ParsedEntry } from "./parsers";
import { invalidateIndex } from "./screen";

export const SOURCES = {
  OFAC_SDN: {
    urls: ["https://sanctionslistservice.ofac.treas.gov/api/download/sdn.csv", "https://sanctionslistservice.ofac.treas.gov/api/download/alt.csv", "https://sanctionslistservice.ofac.treas.gov/api/download/add.csv"],
    parse: (t: string[]) => parseOfac(t[0], t[1], t[2]),
  },
  UN: {
    urls: ["https://scsanctions.un.org/resources/xml/en/consolidated.xml"],
    parse: (t: string[]) => parseUn(t[0]),
  },
  UK: {
    urls: ["https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv"],
    parse: (t: string[]) => parseUk(t[0]),
  },
} as const;

export type ListCode = keyof typeof SOURCES;

async function download(url: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 120_000);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "vaulte-sanctions-sync/1.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`download failed for ${url}: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
}

/** Replace one list's contents atomically. */
export async function storeList(code: string, entries: ParsedEntry[], meta: { version: string; sourceUrl?: string }) {
  await db.$transaction(async tx => {
    await tx.sanctionsAddress.deleteMany({ where: { list: code } });
    await tx.sanctionsEntry.deleteMany({ where: { list: code } });
    const BATCH = 2000;
    for (let i = 0; i < entries.length; i += BATCH) {
      const slice = entries.slice(i, i + BATCH).map(e => ({ ...e, id: randomUUID() }));
      await tx.sanctionsEntry.createMany({
        data: slice.map(e => ({
          id: e.id, list: code, externalId: e.externalId, kind: e.kind, name: e.name, aliases: e.aliases,
          normNames: Array.from(new Set([e.name, ...e.aliases].map(n => normalizeName(n, e.kind === "INDIVIDUAL" ? "INDIVIDUAL" : "ENTITY")).filter(Boolean))),
          birthYears: e.birthYears, countries: e.countries, programs: e.programs,
        })),
        skipDuplicates: true,
      });
      const addrs = slice.flatMap(e => e.addresses.map(a => ({ id: randomUUID(), list: code, asset: a.asset, address: a.address, addrKey: addressKey(a.address), entryId: e.id })));
      if (addrs.length) await tx.sanctionsAddress.createMany({ data: addrs });
    }
    const addressCount = entries.reduce((s, e) => s + e.addresses.length, 0);
    await tx.sanctionsList.upsert({
      where: { code },
      create: { code, version: meta.version, entryCount: entries.length, addressCount, sourceUrl: meta.sourceUrl, status: "OK" },
      update: { version: meta.version, entryCount: entries.length, addressCount, fetchedAt: new Date(), sourceUrl: meta.sourceUrl, status: "OK", error: null },
    });
  }, { timeout: 300_000, maxWait: 30_000 });
  invalidateIndex();
}

/** EVM addresses are case-insensitive (hex); other chains are case-sensitive. */
export function addressKey(a: string): string {
  const t = a.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(t) ? t.toLowerCase() : t;
}

export interface SyncResult { list: string; status: "UPDATED" | "UNCHANGED" | "FAILED"; entries?: number; addresses?: number; error?: string }

export async function syncList(code: ListCode, opts: { force?: boolean } = {}): Promise<SyncResult> {
  const src = SOURCES[code];
  try {
    const texts = await Promise.all(src.urls.map(download));
    const version = createHash("sha256").update(texts.join("\u0000")).digest("hex").slice(0, 16);
    const prev = await db.sanctionsList.findUnique({ where: { code } });
    if (prev && prev.version === version && prev.status === "OK" && !opts.force) {
      await db.sanctionsList.update({ where: { code }, data: { fetchedAt: new Date() } });
      return { list: code, status: "UNCHANGED", entries: prev.entryCount, addresses: prev.addressCount };
    }
    const entries = src.parse(texts as string[]);
    // Guard against a truncated or malformed download wiping a good list.
    if (!entries.length || (prev && prev.entryCount > 100 && entries.length < prev.entryCount * 0.5)) {
      throw new Error(`parsed ${entries.length} entries (previously ${prev?.entryCount ?? 0}); refusing to replace the list`);
    }
    await storeList(code, entries, { version, sourceUrl: src.urls[0] });
    return { list: code, status: "UPDATED", entries: entries.length, addresses: entries.reduce((s, e) => s + e.addresses.length, 0) };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.sanctionsList.upsert({ where: { code }, create: { code, status: "FAILED", error }, update: { status: "FAILED", error } }).catch(() => {});
    return { list: code, status: "FAILED", error };
  }
}

export async function syncAll(opts: { force?: boolean } = {}): Promise<SyncResult[]> {
  const out: SyncResult[] = [];
  for (const code of Object.keys(SOURCES) as ListCode[]) out.push(await syncList(code, opts));
  return out;
}

/** Keep a canonical helper exported for tests. */
export { canonical };
