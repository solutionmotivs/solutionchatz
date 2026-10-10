// Tiny fetch helper for client components.
export interface ApiResult<T = any> {
  ok: boolean;
  status: number;
  data: T;
  error?: { code: string; message: string; dev_code?: string };
}

export async function api<T = any>(url: string, opts: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data, error: res.ok ? undefined : data?.error ?? { code: "ERROR", message: "Request failed" } };
  } catch {
    return { ok: false, status: 0, data: {} as T, error: { code: "NETWORK", message: "Network error. Please try again." } };
  }
}
