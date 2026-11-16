import { API_URL } from './config';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** true, wenn der Fehler auf fehlende Verbindung hindeutet (dann später erneut versuchen). */
export function isNetworkError(e: unknown) {
  return !(e instanceof ApiError) || e.status === 0 || e.status >= 500 || e.status === 429;
}

export async function apiFetch<T = any>(path: string, opts: { method?: string; body?: unknown; token?: string | null; timeoutMs?: number; headers?: Record<string, string>; raw?: boolean } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: {
        Accept: 'application/json',
        ...(opts.body !== undefined && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...opts.headers,
      },
      body: opts.body === undefined ? undefined : opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body),
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError(0, 'offline', 'Keine Verbindung zum Server.');
  } finally {
    clearTimeout(timer);
  }
  if (opts.raw) return res as unknown as T;
  if (res.status === 304) return null as T;
  const ct = res.headers.get('content-type') ?? '';
  const data: any = ct.includes('json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? `Fehler ${res.status}`);
  return data as T;
}
