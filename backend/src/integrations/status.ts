import type { IntegrationKey, IntegrationMode } from '@fvw/shared';
import { q, type Queryable } from '../db';

export const INTEGRATION_LABELS: Record<IntegrationKey, string> = {
  fairgate: 'Fairgate (Mitgliederdaten, FSA)',
  eventfrog: 'Eventfrog (Tageskarten, Organizer API)',
  mail: 'E-Mail-Versand',
  push: 'Push-Nachrichten',
  website: 'Vereinswebseite (Termine)',
  mymaps: 'Google My Maps (Kartenaktualität)',
  sms: 'SMS-Code (Plan B)',
};

export async function setIntegrationStatus(db: Queryable, key: IntegrationKey, mode: IntegrationMode, detail: string) {
  await q(db, `INSERT INTO integration_status(key, mode, detail) VALUES ($1,$2,$3)
    ON CONFLICT (key) DO UPDATE SET mode = EXCLUDED.mode, detail = EXCLUDED.detail, updated_at = now()`, [key, mode, detail]);
}

export async function recordSuccess(db: Queryable, key: IntegrationKey, message: string, details: unknown = null) {
  await q(db, `UPDATE integration_status SET last_success_at = now(), updated_at = now(),
      mode = CASE WHEN mode = 'error' THEN (CASE WHEN detail LIKE 'Demo%' OR detail LIKE 'Test%' OR detail LIKE 'Entwurf%' THEN 'test' ELSE 'active' END) ELSE mode END
    WHERE key = $1`, [key]);
  await q(db, 'INSERT INTO integration_log(key, level, message, details) VALUES ($1,$2,$3,$4)', [key, 'info', message, details === null ? null : JSON.stringify(details)]);
}

export async function recordError(db: Queryable, key: IntegrationKey, message: string, details: unknown = null) {
  await q(db, `UPDATE integration_status SET mode = 'error', last_error_at = now(), last_error = $2, updated_at = now() WHERE key = $1`, [key, message]);
  await q(db, 'INSERT INTO integration_log(key, level, message, details) VALUES ($1,$2,$3,$4)', [key, 'fehler', message, details === null ? null : JSON.stringify(details)]);
}

export async function logIntegration(db: Queryable, key: IntegrationKey, level: 'info' | 'warnung' | 'fehler', message: string, details: unknown = null) {
  await q(db, 'INSERT INTO integration_log(key, level, message, details) VALUES ($1,$2,$3,$4)', [key, level, message, details === null ? null : JSON.stringify(details)]);
}

/** Wiederholungsversuche mit exponentiellem Backoff. */
export async function withRetry<T>(fn: () => Promise<T>, opts: { attempts?: number; baseMs?: number; onError?: (e: unknown, attempt: number) => void } = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  let last: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      opts.onError?.(e, i);
      if (i < attempts) await new Promise((r) => setTimeout(r, (opts.baseMs ?? 500) * 2 ** (i - 1)));
    }
  }
  throw last;
}

export async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20_000);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
