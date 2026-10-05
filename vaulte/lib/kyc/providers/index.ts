import { MockProvider } from "./mock";
import { SandboxCoInProvider } from "./sandbox-co-in";
import type { VerificationProvider } from "./types";

export * from "./types";

let cached: VerificationProvider | null | undefined;

/**
 * KYC_PROVIDER = mock | sandbox_co_in | none.
 * Production never uses the mock; with no real provider every identifier goes to manual staff review.
 */
export function getProvider(): VerificationProvider | null {
  if (cached !== undefined) return cached;
  const want = (process.env.KYC_PROVIDER ?? (process.env.NODE_ENV === "production" ? "none" : "mock")).toLowerCase();
  if (want === "sandbox_co_in" && process.env.SANDBOX_CO_IN_API_KEY && process.env.SANDBOX_CO_IN_API_SECRET) {
    const live = process.env.SANDBOX_CO_IN_ENV === "live";
    cached = new SandboxCoInProvider({
      baseUrl: process.env.SANDBOX_CO_IN_BASE_URL ?? (live ? "https://api.sandbox.co.in" : "https://test-api.sandbox.co.in"),
      apiKey: process.env.SANDBOX_CO_IN_API_KEY,
      apiSecret: process.env.SANDBOX_CO_IN_API_SECRET,
    });
  } else if (want === "mock" && process.env.NODE_ENV !== "production") {
    cached = new MockProvider();
  } else {
    cached = null;
  }
  return cached;
}

/** Test hook. */
export function resetProviderCache() { cached = undefined; }
