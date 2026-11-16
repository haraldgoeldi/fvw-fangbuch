/**
 * Datenbank-Migration: eigene SQL-Migrationen + Better-Auth-Tabellen + Grunddaten (idempotent).
 *   npm run migrate -w @fvw/backend
 */
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getMigrations } from 'better-auth/db/migration';
import { loadConfig } from '../config';
import { createContext, type AppContext } from '../context';
import { q } from '../db';
import { setIntegrationStatus } from '../integrations/status';
import { OPEN_DECISIONS } from '../seed/decisions';
import { seedSpecies } from '../services/catalog';
import { seedMapSources } from '../services/maps';
import { loadEnvFile } from './env';

export async function migrate(ctx: AppContext) {
  await q(ctx.db, 'CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const dir = resolve(import.meta.dirname, '../migrations');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const done = await q(ctx.db, 'SELECT 1 FROM schema_migration WHERE name=$1', [f]);
    if (done.length) continue;
    const sql = await readFile(resolve(dir, f), 'utf8');
    const c = await ctx.db.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql.replace(/CREATE TABLE schema_migration[\s\S]*?\);\s*$/m, ''));
      await c.query('INSERT INTO schema_migration(name) VALUES ($1)', [f]);
      await c.query('COMMIT');
      console.log(`Migration ${f} angewendet`);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  const { runMigrations } = await getMigrations(ctx.auth.options);
  await runMigrations();
  await seedBase(ctx);
}

export async function seedBase(ctx: AppContext) {
  await q(ctx.db, `INSERT INTO season(year, label, note) VALUES (2026, 'Saison 2026', 'Beginn/Ende nicht festgelegt (O26)') ON CONFLICT DO NOTHING`);
  await seedSpecies(ctx.db);
  await seedMapSources(ctx.db, 2026);
  for (const d of OPEN_DECISIONS) {
    await q(ctx.db, `INSERT INTO open_decision(id, question, interim) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET question=EXCLUDED.question, interim=CASE WHEN open_decision.status='offen' THEN EXCLUDED.interim ELSE open_decision.interim END`, [d.id, d.question, d.interim]);
  }
  await refreshIntegrationStatus(ctx);
}

/** Integrationsstatus aus der Konfiguration ableiten (nicht eingerichtet / Testmodus / aktiv). */
export async function refreshIntegrationStatus(ctx: AppContext) {
  const fg = ctx.fairgate.describe();
  await setIntegrationStatus(ctx.db, 'fairgate', !fg.configured ? 'not_configured' : ctx.fairgate.mode === 'demo' ? 'test' : 'active', fg.detail);
  const ef = ctx.eventfrog.describe();
  await setIntegrationStatus(ctx.db, 'eventfrog', !ef.configured ? 'not_configured' : ctx.eventfrog.mode === 'demo' ? 'test' : 'active', ef.detail);
  const m = ctx.mail.describe();
  await setIntegrationStatus(ctx.db, 'mail', m.mode, m.detail);
  const p = ctx.push.describe();
  await setIntegrationStatus(ctx.db, 'push', p.mode, p.detail);
  const w = ctx.website.describe();
  await setIntegrationStatus(ctx.db, 'website', !w.configured ? 'not_configured' : ctx.website.mode === 'demo' ? 'test' : 'active', w.detail);
  const mm = ctx.mymaps.describe();
  await setIntegrationStatus(ctx.db, 'mymaps', !mm.configured ? 'not_configured' : ctx.mymaps.mode === 'file' ? 'test' : 'active', mm.detail);
  await setIntegrationStatus(ctx.db, 'sms', 'not_configured', 'Nicht umgesetzt: kein SMS-Dienst und keine Handynummern verfügbar (O17)');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnvFile();
  const ctx = createContext(loadConfig());
  migrate(ctx).then(() => { console.log('Migration abgeschlossen'); return ctx.db.end(); }).catch((e) => { console.error(e); process.exit(1); });
}
