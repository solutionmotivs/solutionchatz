import { describe, expect, it } from "vitest";
import { inferChain, looksLikeAddress, runSurveillance, trmRisk, trmSanctions } from "../lib/surveillance";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
const json = (body: unknown, status = 201) => (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
const EVM = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const BTC = "149w62rY42aZBox8fGcmqNsXUzSStKeq8C";

describe("wallet surveillance", () => {
  it("recognises real-looking addresses and never sends simulated ones out", async () => {
    expect([EVM, BTC, "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE", "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"].every(looksLikeAddress)).toBe(true);
    expect(["mock_base_ab12", "hello", "0x12"].some(looksLikeAddress)).toBe(false);
    const r = await runSurveillance("mock_solana_ab12cd", { env: env({ WALLET_SCREENING_PROVIDERS: "trm_sanctions" }), fetchImpl: json([]) });
    expect(r).toMatchObject({ outcome: "CLEAR", skipped: true });
    expect(inferChain(EVM)).toBe("ethereum"); expect(inferChain("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU")).toBe("solana");
  });
  it("no providers configured: lists only, nothing is sent", async () => {
    expect((await runSurveillance(EVM, { env: env({}) })).skipped).toBe(true);
  });
  it("TRM sanctions: exposure blocks, otherwise clear; the key goes as Basic auth only when set", async () => {
    let seen: { url: string; auth: string | null } | undefined;
    const f = (async (url: string, init: RequestInit) => { seen = { url, auth: new Headers(init.headers).get("authorization") }; return new Response(JSON.stringify([{ address: BTC, isSanctioned: true }]), { status: 201 }); }) as unknown as typeof fetch;
    const hit = await runSurveillance(BTC, { env: env({ WALLET_SCREENING_PROVIDERS: "trm_sanctions", TRM_API_KEY: "k" }), fetchImpl: f });
    expect(hit.outcome).toBe("BLOCK"); expect(seen!.url).toMatch(/public\/v1\/sanctions\/screening$/); expect(seen!.auth).toBe(`Basic ${Buffer.from("k:k").toString("base64")}`);
    await trmSanctions(env({}), f).check(BTC); expect(seen!.auth).toBeNull();
    expect((await runSurveillance(EVM, { env: env({ WALLET_SCREENING_PROVIDERS: "trm_sanctions" }), fetchImpl: json([{ address: EVM, isSanctioned: false }]) })).outcome).toBe("CLEAR");
  });
  it("TRM risk: high-risk categories hold the transfer for review, low risk passes, a sanctions category blocks", async () => {
    const e = env({ WALLET_SCREENING_PROVIDERS: "trm_risk", TRM_API_KEY: "k" });
    const high = json([{ entities: [{ category: "Mixer", riskScoreLevel: 5, riskScoreLevelLabel: "HIGH" }] }]);
    const r = await runSurveillance(EVM, { env: e, fetchImpl: high });
    expect(r.outcome).toBe("REVIEW"); expect(r.verdicts[0].categories).toEqual(["Mixer"]);
    expect((await runSurveillance(EVM, { env: e, fetchImpl: json([{ addressRiskIndicators: [{ category: "Exchange", categoryRiskScoreLevel: 1 }] }]) })).outcome).toBe("CLEAR");
    expect((await runSurveillance(EVM, { env: env({ ...e, WALLET_RISK_REVIEW_LEVEL: "MEDIUM" }), fetchImpl: json([{ addressRiskIndicators: [{ category: "Gambling", categoryRiskScoreLevel: 3, categoryRiskScoreLevelLabel: "MEDIUM" }] }]) })).outcome).toBe("REVIEW");
    expect((await runSurveillance(EVM, { env: e, fetchImpl: json([{ entities: [{ category: "Sanctions", riskScoreLevelLabel: "SEVERE" }] }]) })).outcome).toBe("BLOCK");
  });
  it("a provider outage holds the transfer by default and continues only when set to open", async () => {
    const down = json({}, 503);
    const e = { WALLET_SCREENING_PROVIDERS: "trm_sanctions" };
    const closed = await runSurveillance(EVM, { env: env(e), fetchImpl: down });
    expect(closed.outcome).toBe("REVIEW"); expect(closed.failed[0].provider).toBe("trm_sanctions");
    expect((await runSurveillance(EVM, { env: env({ ...e, WALLET_FAIL_MODE: "open" }), fetchImpl: down })).outcome).toBe("CLEAR");
  });
  it("one provider failing does not hide another's hit", async () => {
    const f = (async (url: string) => (url.includes("v2") ? new Response("{}", { status: 500 }) : new Response(JSON.stringify([{ address: BTC, isSanctioned: true }]), { status: 201 }))) as unknown as typeof fetch;
    expect((await runSurveillance(BTC, { env: env({ WALLET_SCREENING_PROVIDERS: "trm_sanctions,trm_risk", TRM_API_KEY: "k" }), fetchImpl: f })).outcome).toBe("BLOCK");
  });
  it("trm_risk and chainalysis do nothing without their keys", async () => {
    expect(await trmRisk(env({})).check(EVM)).toBeNull();
  });
});
