// Push completed transfers to a connected accounting system, once each, with retries on later runs.
import { db } from "@/lib/db";
import { decryptString, encryptString, hmacHex, otpPepper } from "@/lib/security/crypto";
import { emitWebhookEvent } from "@/lib/webhooks/dispatch";
import { ADAPTERS, ErpApiError, ErpAuthError, type Tokens } from "./connectors";
import { buildVoucher, homeCurrency, perspectiveFor, voucherBalanced, type ErpMapping, type TransferForVoucher } from "./vouchers";

export const redirectUri = (provider: string) => `${(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/api/integrations/${provider.toLowerCase()}/callback`;

// ── OAuth state (signed, expiring, bound to org + user) ──
export function signState(p: { org: string; user: string; provider: string }): string {
  const body = Buffer.from(JSON.stringify({ ...p, exp: Date.now() + 10 * 60_000, n: Math.random().toString(36).slice(2) })).toString("base64url");
  return `${body}.${hmacHex(otpPepper(), `erp-state:${body}`)}`;
}
export function readState(s: string): { org: string; user: string; provider: string } | null {
  const [body, sig] = s.split(".");
  if (!body || !sig || hmacHex(otpPepper(), `erp-state:${body}`) !== sig) return null;
  try { const p = JSON.parse(Buffer.from(body, "base64url").toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}

export const storeTokens = (t: Tokens) => ({ accessEnc: encryptString(t.access), refreshEnc: t.refresh ? encryptString(t.refresh) : null, expiresAt: t.expiresAt ?? null });
const loadTokens = (c: { accessEnc: string | null; refreshEnc: string | null; expiresAt: Date | null }): Tokens => ({ access: c.accessEnc ? decryptString(c.accessEnc) : "", refresh: c.refreshEnc ? decryptString(c.refreshEnc) : undefined, expiresAt: c.expiresAt ?? undefined });

export async function transfersForVouchers(orgId: string, opts: { since?: Date; until?: Date; ids?: string[]; limit?: number } = {}) {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { country: true } });
  const rows = await db.transfer.findMany({
    where: { organizationId: orgId, status: "COMPLETED", ...(opts.ids ? { id: { in: opts.ids } } : {}), ...(opts.since || opts.until ? { completedAt: { ...(opts.since ? { gte: opts.since } : {}), ...(opts.until ? { lte: opts.until } : {}) } } : {}) },
    orderBy: { completedAt: "asc" }, take: opts.limit ?? 500, include: { sender: { select: { legalName: true } }, recipient: { select: { legalName: true } } },
  });
  const invs = await db.invoice.findMany({ where: { id: { in: rows.map(r => r.invoiceId).filter((x): x is string => !!x) } }, select: { id: true, number: true } });
  const num = new Map(invs.map(i => [i.id, i.number]));
  return { org, items: rows.map(r => ({ transfer: r, data: { id: r.id, completedAt: r.completedAt, createdAt: r.createdAt, sourceCurrency: r.sourceCurrency, destCurrency: r.destCurrency, sourceAmount: r.sourceAmount, destAmount: r.destAmount, sourceAmountUsd: r.sourceAmountUsd, partnerCostUsd: r.partnerCostUsd, markupUsd: r.markupUsd, externalRef: r.externalRef, originCountry: r.originCountry, destCountry: r.destCountry, fundingMethod: r.fundingMethod, senderName: r.sender.legalName, recipientName: r.recipient.legalName, invoiceNumber: r.invoiceId ? num.get(r.invoiceId) ?? null : null } as TransferForVoucher })) };
}

export interface SyncSummary { synced: number; failed: number; skipped: number; errors: { transferId: string; error: string }[] }

export async function syncConnection(connectionId: string, opts: { limit?: number } = {}): Promise<SyncSummary> {
  const conn = await db.erpConnection.findUniqueOrThrow({ where: { id: connectionId } });
  const adapter = ADAPTERS[conn.provider];
  const out: SyncSummary = { synced: 0, failed: 0, skipped: 0, errors: [] };
  if (!adapter || conn.status !== "CONNECTED") return out;
  const mapping = (conn.mapping ?? {}) as ErpMapping;
  const done = new Set((await db.erpSyncRecord.findMany({ where: { organizationId: conn.organizationId, provider: conn.provider, status: { in: ["SYNCED", "SKIPPED"] } }, select: { transferId: true } })).map(r => r.transferId));
  const { org, items } = await transfersForVouchers(conn.organizationId, { since: conn.syncFrom, limit: 500 });
  const base = mapping.base_currency ?? homeCurrency(org?.country ?? null);
  let tokens = loadTokens(conn);
  const record = (transferId: string, data: { status: string; externalId?: string; error?: string | null }) =>
    db.erpSyncRecord.upsert({
      where: { organizationId_provider_transferId: { organizationId: conn.organizationId, provider: conn.provider, transferId } },
      create: { organizationId: conn.organizationId, provider: conn.provider, transferId, status: data.status, externalId: data.externalId ?? null, error: data.error ?? null, attempts: 1, syncedAt: data.status === "SYNCED" ? new Date() : null },
      update: { status: data.status, externalId: data.externalId ?? null, error: data.error ?? null, attempts: { increment: 1 }, syncedAt: data.status === "SYNCED" ? new Date() : null },
    });

  for (const { transfer, data } of items) {
    if (done.has(transfer.id) || out.synced + out.failed >= (opts.limit ?? 100)) continue;
    const v = buildVoucher(data, perspectiveFor(data, org?.country ?? null));
    if (!voucherBalanced(v)) { await record(transfer.id, { status: "FAILED", error: "voucher does not balance" }); out.failed++; continue; }
    if (v.currency !== base) { await record(transfer.id, { status: "SKIPPED", error: `Transfer currency ${v.currency} differs from your accounting currency ${base}; export it with the CSV/JSON export` }); out.skipped++; continue; }
    try {
      if (tokens.expiresAt && tokens.expiresAt.getTime() < Date.now() + 60_000) tokens = await refreshTokens(conn.id, adapter, tokens);
      let r;
      try { r = await adapter.push({ tokens, tenant: conn.tenant ?? "", mapping }, v); }
      catch (e) { if (e instanceof ErpAuthError) { tokens = await refreshTokens(conn.id, adapter, tokens); r = await adapter.push({ tokens, tenant: conn.tenant ?? "", mapping }, v); } else throw e; }
      await record(transfer.id, { status: "SYNCED", externalId: r.externalId });
      out.synced++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "sync failed";
      await record(transfer.id, { status: "FAILED", error: msg });
      out.failed++; out.errors.push({ transferId: transfer.id, error: msg });
      await emitWebhookEvent({ organizationId: conn.organizationId, event: "erp.sync_failed", data: { provider: conn.provider, transfer_id: transfer.id, error: msg } }).catch(() => {});
      if (e instanceof ErpAuthError) { await db.erpConnection.update({ where: { id: conn.id }, data: { status: "NEEDS_REAUTH", lastError: msg } }); break; }
    }
  }
  await db.erpConnection.update({ where: { id: conn.id }, data: { lastSyncAt: new Date(), lastError: out.errors[0]?.error ?? null } });
  if (out.synced) await emitWebhookEvent({ organizationId: conn.organizationId, event: "erp.sync_completed", data: { provider: conn.provider, synced: out.synced } }).catch(() => {});
  return out;
}

async function refreshTokens(connId: string, adapter: (typeof ADAPTERS)[string], tokens: Tokens): Promise<Tokens> {
  const t = await adapter.refresh(tokens);
  await db.erpConnection.update({ where: { id: connId }, data: storeTokens(t) });
  return t;
}

export async function syncAllConnections(): Promise<{ connections: number; synced: number; failed: number }> {
  const conns = await db.erpConnection.findMany({ where: { status: "CONNECTED", provider: { in: ["QUICKBOOKS", "ZOHO", "XERO"] } } });
  let synced = 0, failed = 0;
  for (const c of conns) { const r = await syncConnection(c.id).catch(() => ({ synced: 0, failed: 1 }) as SyncSummary); synced += r.synced; failed += r.failed; }
  return { connections: conns.length, synced, failed };
}

export { ErpApiError };
