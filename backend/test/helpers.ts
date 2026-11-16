import { mkdirSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createContext, type AppContext } from '../src/context';
import { migrate } from '../src/cli/migrate';
import { seedDemo } from '../src/cli/seed-demo';
import { generateSigningKey } from '../src/credentials';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5433/fvw_test';
const KML_DIR = resolve(import.meta.dirname, '../../data/source/2026/kml-live-abruf');

/** Frische Test-Datenbank (Schema neu) + Demo-Daten. My-Maps im Dateimodus (keine Netzwerkzugriffe). */
export async function setup(overrides: Record<string, string> = {}) {
  const admin = new pg.Client({ connectionString: TEST_DB });
  await admin.connect();
  await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await admin.end();
  const mm = mkdtempSync(join(tmpdir(), 'fvw-mymaps-'));
  copyFileSync(join(KML_DIR, 'aktive-fischer-2026.kml'), join(mm, '1ix9IEIuiCC-A4pySRwl-xYhhiiOMXf8.kml'));
  copyFileSync(join(KML_DIR, 'jugendfischer-2026.kml'), join(mm, '1gneLQ1JulxHv-ZE7Kz2pTtQEb32D_jM.kml'));
  copyFileSync(join(KML_DIR, 'tageskarte-2026.kml'), join(mm, '1GOP3PF7BT3ops0HwjviU5NQaVWDJgk0.kml'));
  const storage = mkdtempSync(join(tmpdir(), 'fvw-storage-'));
  mkdirSync(storage, { recursive: true });
  const cfg = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: TEST_DB, BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-1234567890',
    CREDENTIAL_SIGNING_KEY: generateSigningKey(), DEMO_MODE: 'true', FAIRGATE_MODE: 'demo', EVENTFROG_MODE: 'demo', WEBSITE_MODE: 'demo',
    MAIL_MODE: 'draft', PUSH_MODE: 'draft', MYMAPS_MODE: 'file', MYMAPS_FILE_DIR: mm, STORAGE_DIR: storage, JOBS_ENABLED: 'false', ...overrides,
  });
  const ctx = createContext(cfg);
  await migrate(ctx);
  await seedDemo(ctx);
  const app = createApp(ctx);
  return { ctx, app, mymapsDir: mm };
}

export type T = Awaited<ReturnType<typeof setup>>;

export async function login(t: T, email: string): Promise<string> {
  const r1 = await t.app.request('/api/auth/request-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  if (r1.status !== 200) throw new Error(`request-code ${r1.status}`);
  const mails = await (await t.app.request(`/api/demo/mailbox?email=${encodeURIComponent(email)}`)).json() as any[];
  const code = /lautet: (\d{6})/.exec(mails[0]?.body ?? '')?.[1];
  if (!code) throw new Error(`Kein Code für ${email}`);
  const r2 = await t.app.request('/api/auth/verify-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code }) });
  const body = await r2.json() as any;
  if (!body.token) throw new Error(`verify ${r2.status} ${JSON.stringify(body)}`);
  return body.token;
}

export async function api(t: T, token: string | null, path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await t.app.request(path, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data: data as any, headers: res.headers };
}

export const uuid = () => crypto.randomUUID();
export type { AppContext };
