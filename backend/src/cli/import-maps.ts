/**
 * Importiert Kartendateien (KML/KMZ) als Versionen und aktiviert sie, falls für die Kartengruppe noch keine
 * Version aktiv ist. Standard: die Dateien aus data/source/2026/kml-live-abruf (Live-Abruf, NICHT als geprüfte
 * Basis markiert). Mit --verified werden die Versionen als geprüfte Basis aktiviert (nur für bestätigte Exporte!).
 *   npm run import:maps -w @fvw/backend -- [--dir <pfad>] [--verified]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MapGroup } from '@fvw/shared';
import { loadConfig } from '../config';
import { createContext, type AppContext } from '../context';
import { one } from '../db';
import { activateVersion, importVersion } from '../services/maps';
import { loadEnvFile } from './env';

const FILES: Record<MapGroup, string> = { aktive: 'aktive-fischer-2026.kml', jugend: 'jugendfischer-2026.kml', tageskarte: 'tageskarte-2026.kml' };

export async function importBundledMaps(ctx: AppContext, dir = resolve(import.meta.dirname, '../../../data/source/2026/kml-live-abruf'), verified = false) {
  const actor = { personId: null, label: 'Import (CLI)' };
  const out: Record<string, unknown> = {};
  for (const [group, file] of Object.entries(FILES) as [MapGroup, string][]) {
    const res = await importVersion(ctx, { group, season: 2026, buffer: readFileSync(resolve(dir, file)), source: 'bundled', sourceName: file, actor,
      note: verified ? 'Geprüfte KML-Basis' : 'Live-Abruf vom 15.11.2026 – noch nicht als geprüfte Basis bestätigt' });
    const active = await one(ctx.db, `SELECT id FROM map_version WHERE map_group=$1 AND season_year=2026 AND status='aktiv'`, [group]);
    if (!active || verified) await activateVersion(ctx, res.id, actor, { verifiedBase: verified });
    out[group] = res;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnvFile();
  const args = process.argv.slice(2);
  const dir = args.includes('--dir') ? resolve(args[args.indexOf('--dir') + 1]) : undefined;
  const ctx = createContext(loadConfig());
  importBundledMaps(ctx, dir, args.includes('--verified'))
    .then((r) => { console.log(JSON.stringify(r, null, 2)); return ctx.db.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
