import { DEFAULT_FISH_SPECIES, type MapGroup } from '@fvw/shared';
import type { Principal } from '../authz';
import type { AppContext } from '../context';
import { q, type Queryable } from '../db';
import { activeAnalysis } from './maps';

export async function seedSpecies(db: Queryable) {
  let i = 0;
  for (const s of DEFAULT_FISH_SPECIES) await q(db, `INSERT INTO fish_species(name, sort) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING`, [s, i++]);
}

export async function speciesNames(db: Queryable, includeInactive = false): Promise<string[]> {
  const rows = await q<{ name: string }>(db, `SELECT name FROM fish_species ${includeInactive ? '' : 'WHERE active'} ORDER BY sort, name`);
  return rows.map((r) => r.name);
}

/**
 * Gewässerliste für den Tourstart: Gewässer aus den aktiven Karten der erlaubten Kartengruppen,
 * vom Vorstand bestätigte Vorschläge sowie eigene ungeprüfte Vorschläge (nur für die vorschlagende Person).
 */
export async function watersFor(ctx: AppContext, p: Principal, groups: MapGroup[], season: number) {
  const { result } = await activeAnalysis(ctx, season);
  const fromMap = result.waters.filter((w) => w.groups.some((g) => groups.includes(g))).map((w) => ({
    key: w.key, name: w.name, groups: w.groups.filter((g) => groups.includes(g)), codes: w.codes, hasClosedSection: w.hasClosedSection, status: 'aus_karte' as const,
  }));
  const extra = await q<any>(ctx.db, `SELECT key, name, status, map_groups, suggested_by FROM water WHERE source='person' AND (status='bestaetigt' OR (status='ungeprueft' AND suggested_by=$1))`, [p.personId]);
  return [
    ...fromMap,
    ...extra.map((w) => ({ key: w.key, name: w.name, groups: w.map_groups, codes: [], hasClosedSection: false, status: w.status as 'bestaetigt' | 'ungeprueft' })),
  ].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
