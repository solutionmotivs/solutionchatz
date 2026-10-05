// Structured JSON logs (one line per event) so a log platform can index them. Never log secrets, OTPs, tokens, full
// identifiers or document contents: pass ids and codes only.
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (ORDER[level] < ORDER[(process.env.LOG_LEVEL as Level) ?? "info"]) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...redact(fields) });
  (level === "error" || level === "warn" ? console.error : console.log)(line);
}

const SENSITIVE = /pass(word)?|secret|token|authorization|cookie|otp|code$|apikey|api_key|iban|account_?number|pan$|value_?enc|private/i;
function redact(o: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (SENSITIVE.test(k)) out[k] = "[redacted]";
    else if (v instanceof Error) out[k] = { name: v.name, message: v.message.slice(0, 500) };
    else if (v && typeof v === "object" && !Array.isArray(v) && depth < 3) out[k] = redact(v as Record<string, unknown>, depth + 1);
    else out[k] = typeof v === "bigint" ? v.toString() : v;
  }
  return out;
}
