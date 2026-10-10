// Wallet-address screening: exact match against crypto addresses published on the OFAC SDN list (and optionally Chainalysis).
// Official lists always run. Blockchain-analytics providers (TRM, Chainalysis) are added with WALLET_SCREENING_PROVIDERS: see lib/surveillance.
// Exposure to mixers or indirect links needs a paid risk provider; partners usually run their own as well.
import { screenWalletAddress, type Ctx } from "@/lib/sanctions/screen";

export async function screenWallet(address: string, ctx: Partial<Ctx> = {}): Promise<{ cleared: boolean; reason?: string }> {
  const r = await screenWalletAddress(address, { subjectType: "WALLET", ...ctx });
  if (r.outcome === "BLOCK") return { cleared: false, reason: "Address matches a sanctions listing" };
  if (r.outcome === "REVIEW") return { cleared: false, reason: "Wallet risk review: an analytics provider flagged this address or was unavailable" };
  return { cleared: true };
}
