// On-chain wallet surveillance: ask one or more blockchain-analytics providers about an address and turn the answers into one decision.
//   WALLET_SCREENING_PROVIDERS = comma list of: trm_sanctions, chainalysis, trm_risk   (empty = official lists only, see lib/sanctions)
//   WALLET_FAIL_MODE           = closed (default: a provider outage sends the transfer to review) | open (continue on the lists alone)
//   WALLET_RISK_REVIEW_LEVEL   = HIGH (default) | MEDIUM | SEVERE : the risk level at which a transfer is held for review
// Providers see the wallet address (and chain). Name them in the privacy notice before enabling a provider in live mode.
export type RiskLevel = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "SEVERE";
const ORDER: RiskLevel[] = ["NONE", "LOW", "MEDIUM", "HIGH", "SEVERE"];
export const riskRank = (l: RiskLevel) => ORDER.indexOf(l);

export interface WalletVerdict { provider: string; sanctioned: boolean; risk: RiskLevel; categories: string[]; detail: string }
export interface SurveillanceProvider { id: string; check(address: string, chain?: string): Promise<WalletVerdict | null> }

/** Format sniffing so simulated or malformed addresses are never sent to a third party. */
export function looksLikeAddress(a: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(a) || /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a) || /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(a) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
}

/** Best guess of the chain family from the address format (EVM chains share one address format). */
export function inferChain(a: string): string | undefined {
  return /^0x/i.test(a) ? "ethereum" : /^T/.test(a) && a.length === 34 ? "tron" : /^(bc1|[13])/.test(a) && a.length <= 62 && !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(a) ? "bitcoin" : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) ? "solana" : undefined;
}

const timeout = (ms = 8000) => AbortSignal.timeout(ms);
const basic = (key: string) => `Basic ${Buffer.from(`${key}:${key}`).toString("base64")}`;

/** TRM Sanctions API. Free with no key (about 100 checks a day); with a key (TRM_API_KEY) the limits are far higher. Verified live. */
export function trmSanctions(env: NodeJS.ProcessEnv = process.env, f: typeof fetch = fetch): SurveillanceProvider {
  return {
    id: "trm_sanctions",
    async check(address) {
      const key = env.TRM_API_KEY;
      const res = await f(`${env.TRM_BASE_URL ?? "https://api.trmlabs.com"}/public/v1/sanctions/screening`, {
        method: "POST", headers: { "content-type": "application/json", ...(key ? { Authorization: basic(key) } : {}) }, body: JSON.stringify([{ address }]), signal: timeout(),
      });
      if (!res.ok) throw new Error(`TRM sanctions API ${res.status}`);
      const j = (await res.json()) as { address: string; isSanctioned: boolean }[];
      const hit = j.find(x => x.address.toLowerCase() === address.toLowerCase())?.isSanctioned === true;
      return { provider: "trm_sanctions", sanctioned: hit, risk: hit ? "SEVERE" : "NONE", categories: hit ? ["sanctions"] : [], detail: hit ? "TRM: address has sanctions exposure" : "" };
    },
  };
}

/** Chainalysis free sanctions screening API (CHAINALYSIS_API_KEY). Contract per Chainalysis's public documentation; not verifiable from this build environment. */
export function chainalysisSanctions(env: NodeJS.ProcessEnv = process.env, f: typeof fetch = fetch): SurveillanceProvider {
  return {
    id: "chainalysis",
    async check(address) {
      const key = env.CHAINALYSIS_API_KEY;
      if (!key) return null;
      const res = await f(`${env.CHAINALYSIS_BASE_URL ?? "https://public.chainalysis.com/api/v1/address"}/${encodeURIComponent(address)}`, { headers: { "X-API-Key": key, Accept: "application/json" }, signal: timeout() });
      if (!res.ok) throw new Error(`Chainalysis API ${res.status}`);
      const j = (await res.json()) as { identifications?: { category?: string; name?: string }[] };
      const first = j.identifications?.[0];
      return { provider: "chainalysis", sanctioned: !!first, risk: first ? "SEVERE" : "NONE", categories: first ? [first.category ?? "sanctions"] : [], detail: first ? `${first.category ?? "sanctions"}: ${first.name ?? ""}` : "" };
    },
  };
}

const TRM_CHAIN: Record<string, string> = { ethereum: "ethereum", base: "base", polygon: "polygon", solana: "solana", tron: "tron", bitcoin: "bitcoin" };
function trmLevel(label: unknown, n: unknown): RiskLevel {
  const s = String(label ?? "").toUpperCase();
  if (s === "SEVERE" || s === "HIGH" || s === "MEDIUM" || s === "LOW") return s as RiskLevel;
  const v = typeof n === "number" ? n : NaN;
  return v >= 10 ? "SEVERE" : v >= 5 ? "HIGH" : v >= 1 ? "MEDIUM" : "NONE";
}

/**
 * TRM address risk screening (paid; TRM_API_KEY). Request/response shape as I know TRM's v2 screening API
 * (POST /public/v2/screening/addresses with Basic auth; entities[] and addressRiskIndicators[] each carry a risk level). TRM's reference for it
 * is behind its customer login, so this adapter is contract-tested against a stub only: run scripts/wallet-check.mjs with your key to confirm.
 */
export function trmRisk(env: NodeJS.ProcessEnv = process.env, f: typeof fetch = fetch): SurveillanceProvider {
  return {
    id: "trm_risk",
    async check(address, chain) {
      const key = env.TRM_API_KEY;
      if (!key) return null;
      const res = await f(`${env.TRM_BASE_URL ?? "https://api.trmlabs.com"}/public/v2/screening/addresses`, {
        method: "POST", headers: { "content-type": "application/json", Authorization: basic(key) }, body: JSON.stringify([{ address, chain: TRM_CHAIN[chain ?? ""] ?? chain ?? "ethereum" }]), signal: timeout(),
      });
      if (!res.ok) throw new Error(`TRM risk API ${res.status}`);
      const j = (await res.json()) as { entities?: { category?: string; riskScoreLevel?: number; riskScoreLevelLabel?: string }[]; addressRiskIndicators?: { category?: string; categoryRiskScoreLevel?: number; categoryRiskScoreLevelLabel?: string }[] }[];
      const r = j[0] ?? {};
      const levels: { level: RiskLevel; cat: string }[] = [
        ...(r.entities ?? []).map(e => ({ level: trmLevel(e.riskScoreLevelLabel, e.riskScoreLevel), cat: e.category ?? "entity" })),
        ...(r.addressRiskIndicators ?? []).map(e => ({ level: trmLevel(e.categoryRiskScoreLevelLabel, e.categoryRiskScoreLevel), cat: e.category ?? "indicator" })),
      ];
      const top = levels.reduce<RiskLevel>((m, x) => (riskRank(x.level) > riskRank(m) ? x.level : m), "NONE");
      const cats = Array.from(new Set(levels.filter(x => riskRank(x.level) >= riskRank("MEDIUM")).map(x => x.cat)));
      return { provider: "trm_risk", sanctioned: cats.some(c => /sanction/i.test(c)), risk: top, categories: cats, detail: cats.length ? `TRM: ${cats.join(", ")}` : "" };
    },
  };
}

export function enabledProviders(env: NodeJS.ProcessEnv = process.env, f: typeof fetch = fetch): SurveillanceProvider[] {
  const want = (env.WALLET_SCREENING_PROVIDERS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const all: Record<string, SurveillanceProvider> = { trm_sanctions: trmSanctions(env, f), chainalysis: chainalysisSanctions(env, f), trm_risk: trmRisk(env, f) };
  return want.map(w => all[w]).filter(Boolean);
}

export interface SurveillanceResult {
  outcome: "CLEAR" | "REVIEW" | "BLOCK";
  verdicts: WalletVerdict[];
  failed: { provider: string; error: string }[];
  /** True when no provider was asked (none configured, or the address does not look real). */
  skipped: boolean;
  note?: string;
}

export async function runSurveillance(address: string, opts: { chain?: string; env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}): Promise<SurveillanceResult> {
  const env = opts.env ?? process.env;
  const providers = enabledProviders(env, opts.fetchImpl ?? fetch);
  if (!providers.length) return { outcome: "CLEAR", verdicts: [], failed: [], skipped: true };
  if (!looksLikeAddress(address)) return { outcome: "CLEAR", verdicts: [], failed: [], skipped: true, note: "not a real-looking address; not sent to providers" };
  const failed: SurveillanceResult["failed"] = []; const verdicts: WalletVerdict[] = [];
  await Promise.all(providers.map(async p => {
    try { const v = await p.check(address, opts.chain ?? inferChain(address)); if (v) verdicts.push(v); } catch (e) { failed.push({ provider: p.id, error: e instanceof Error ? e.message : String(e) }); }
  }));
  const threshold = (["MEDIUM", "HIGH", "SEVERE"].includes(env.WALLET_RISK_REVIEW_LEVEL ?? "") ? env.WALLET_RISK_REVIEW_LEVEL : "HIGH") as RiskLevel;
  if (verdicts.some(v => v.sanctioned)) return { outcome: "BLOCK", verdicts, failed, skipped: false };
  if (verdicts.some(v => riskRank(v.risk) >= riskRank(threshold))) return { outcome: "REVIEW", verdicts, failed, skipped: false, note: "wallet risk at or above the review level" };
  if (failed.length && (env.WALLET_FAIL_MODE ?? "closed") !== "open" && !verdicts.length) return { outcome: "REVIEW", verdicts, failed, skipped: false, note: "wallet screening provider unavailable; held for review" };
  return { outcome: "CLEAR", verdicts, failed, skipped: false };
}
