// Live-corridor allowlist. Until counsel has cleared a country for live operation, the operator can keep it closed:
// LIVE_COUNTRIES="IN,US,GB" means live (verified-account) transfers are only allowed when BOTH the sender's and the
// recipient's country are in the list. Test mode is never restricted. Unset = no restriction (preflight warns about that).
export function liveCountries(env: NodeJS.ProcessEnv = process.env): Set<string> | null {
  const raw = env.LIVE_COUNTRIES?.trim();
  if (!raw) return null;
  return new Set(raw.split(",").map(s => s.trim().toUpperCase()).filter(c => /^[A-Z]{2}$/.test(c)));
}

/** Returns the countries that block a live corridor (empty = allowed). */
export function closedCountries(origin: string, dest: string, sandbox: boolean, env: NodeJS.ProcessEnv = process.env): string[] {
  if (sandbox) return [];
  const open = liveCountries(env);
  if (!open) return [];
  return Array.from(new Set([origin.toUpperCase(), dest.toUpperCase()])).filter(c => !open.has(c));
}
