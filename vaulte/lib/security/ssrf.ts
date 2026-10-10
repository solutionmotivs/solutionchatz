// Guards outbound webhook calls against SSRF (internal IPs, cloud metadata, localhost).
import { lookup } from "dns/promises";
import { isIP } from "net";

export function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
    return (
      v === "::1" || v === "::" || v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")
    );
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(n => Number.isNaN(n))) return true;
  const [a, b] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    a >= 224
  );
}

/** Syntactic checks only (no DNS). Used at registration time. */
export function validateWebhookUrlShape(raw: string): { ok: boolean; reason?: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
  const allowHttp = process.env.NODE_ENV !== "production";
  if (u.protocol !== "https:" && !(allowHttp && u.protocol === "http:")) {
    return { ok: false, reason: "Webhook URL must use https" };
  }
  if (u.username || u.password) return { ok: false, reason: "Credentials in URL are not allowed" };
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    if (!allowHttp) return { ok: false, reason: "Internal hostnames are not allowed" };
  }
  if (isIP(host) && isPrivateIp(host) && !allowHttp) {
    return { ok: false, reason: "Private or reserved IP addresses are not allowed" };
  }
  if (isIP(host) && isPrivateIp(host) && allowHttp && host !== "127.0.0.1" && host !== "::1") {
    return { ok: false, reason: "Private or reserved IP addresses are not allowed" };
  }
  return { ok: true };
}

/** Full check including DNS resolution; used right before every delivery to defeat DNS rebinding. */
export async function assertPublicUrl(raw: string): Promise<void> {
  const shape = validateWebhookUrlShape(raw);
  if (!shape.ok) throw new Error(shape.reason);
  const u = new URL(raw);
  if (process.env.NODE_ENV !== "production" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return;
  const addrs = await lookup(u.hostname, { all: true });
  if (!addrs.length) throw new Error("Hostname did not resolve");
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new Error("Hostname resolves to a private or reserved address");
  }
}
