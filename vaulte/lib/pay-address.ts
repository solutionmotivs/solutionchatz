// Pay ID: acme@vaulte. Letters, digits, dot, underscore, hyphen; 3 to 30 characters; no look-alike or authority words.
export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9._-]{1,28})[a-z0-9]$/;
export const RESERVED = new Set(["admin", "administrator", "support", "help", "security", "billing", "payments", "payment", "pay", "payout", "official", "vaulte", "vault", "team", "staff", "root", "system", "api", "www", "mail", "legal", "compliance", "bank", "banking", "rbi", "irs", "fiu", "sebi", "swift", "visa", "mastercard", "stripe", "paypal", "wise", "nium", "circle", "bridge", "airwallex", "currencycloud"]);

export function normaliseHandle(raw: string): string { return raw.trim().replace(/^@+/, "").replace(/@vaulte$/i, "").toLowerCase(); }

export function validateHandle(handle: string): string | null {
  if (!HANDLE_RE.test(handle)) return "Use 3 to 30 letters, digits, dots, underscores or hyphens, starting and ending with a letter or digit";
  if (/[._-]{2,}/.test(handle)) return "Do not repeat dots, underscores or hyphens";
  if (/^\d+$/.test(handle)) return "A handle cannot be only digits";
  if (RESERVED.has(handle) || RESERVED.has(handle.replace(/[._-]/g, ""))) return "That handle is reserved";
  return null;
}

export const formatHandle = (handle: string) => `${handle}@vaulte`;
