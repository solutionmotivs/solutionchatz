// Tiny shared HTTP helper for partner adapters: timeout, JSON or form bodies, never throws on non-2xx.
export interface HttpResult { status: number; json: any; headers: Headers }

export async function http(url: string, init: { method?: string; headers?: Record<string, string>; json?: unknown; form?: Record<string, string | number | boolean | undefined>; timeoutMs?: number } = {}): Promise<HttpResult> {
  const headers: Record<string, string> = { Accept: "application/json", ...init.headers };
  let body: string | undefined;
  if (init.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(init.json); }
  else if (init.form) { headers["Content-Type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(Object.entries(init.form).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString(); }
  const res = await fetch(url, { method: init.method ?? (body ? "POST" : "GET"), headers, body, signal: AbortSignal.timeout(init.timeoutMs ?? 20_000) });
  let json: any = null; try { json = await res.json(); } catch {}
  return { status: res.status, json, headers: res.headers };
}

export class PartnerError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
  /** 4xx other than auth/rate-limit: the partner refused this request; retrying the same request will not help. */
  get permanent() { return this.status >= 400 && this.status < 500 && ![401, 408, 429].includes(this.status); }
}
