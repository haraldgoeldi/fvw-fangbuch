import { createHash } from 'node:crypto';
import {
  EXPECTED_LAYER_COUNTS, hash53, importMaps, LAYER_RULES, MAP_GROUPS, parseKml,
  type Closure, type ImportResult, type IssueDecisions, type LayerKind, type MapGroup, type Section,
} from '@fvw/shared';
import { audit, SYSTEM, type Actor } from '../audit';
import { HttpError } from '../authz';
import type { AppContext } from '../context';
import { one, q, tx, type Queryable } from '../db';
import { kmlFromBuffer } from '../integrations/mymaps';
import { logIntegration, recordError, recordSuccess } from '../integrations/status';
import { getSetting } from '../settings';

const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

export async function seedMapSources(db: Queryable, season: number) {
  for (const g of MAP_GROUPS) {
    await q(db, `INSERT INTO map_source(season_year, map_group, title, my_maps_id, network_link_url) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (season_year, map_group) DO NOTHING`, [season, g.key, g.title, g.myMapsId, `https://www.google.com/maps/d/u/0/kml?mid=${g.myMapsId}`]);
  }
}

async function decisionsFor(db: Queryable, season: number): Promise<IssueDecisions> {
  const rows = await q<any>(db, 'SELECT issue_id, status, value FROM map_issue_decision WHERE season_year = $1', [season]);
  return Object.fromEntries(rows.map((r) => [r.issue_id, { status: r.status, value: r.value }]));
}

function inputFor(group: MapGroup, kml: string, bytes: number, sha256: string) {
  const g = MAP_GROUPS.find((x) => x.key === group)!;
  return { group, kml, sha256, bytes, expectedObjects: g.expectedObjects, expectedNames: g.expectedNames, expectedLayerCounts: EXPECTED_LAYER_COUNTS[group] };
}

/** Neue Kartenversion speichern (Entwurf). Gleiche Prüfsumme → bestehende Version, keine Duplikate. */
export async function importVersion(ctx: AppContext, opts: { group: MapGroup; season: number; buffer: Buffer; source: 'kml_upload' | 'kmz_upload' | 'network_link' | 'bundled'; sourceName?: string; actor: Actor; note?: string }) {
  const { kml, format } = await kmlFromBuffer(opts.buffer);
  const doc = parseKml(kml);
  if (doc.networkLinkOnly) {
    throw new HttpError(422, 'network_link_only',
      `Die Datei enthält nur einen Netzwerklink (${doc.networkLinks.map((l) => l.href).join(', ')}) und keine Kartendaten. Bitte die vollständige KML-Datei importieren oder den Netzwerklink über «Jetzt prüfen» abrufen.`);
  }
  if (doc.placemarks.length === 0) throw new HttpError(422, 'empty', 'Die Datei enthält keine Kartenobjekte.');
  const digest = sha(kml);
  const existing = await one<any>(ctx.db, 'SELECT id, status FROM map_version WHERE map_group=$1 AND season_year=$2 AND sha256=$3 ORDER BY created_at DESC LIMIT 1', [opts.group, opts.season, digest]);
  if (existing) return { id: existing.id as string, duplicate: true, status: existing.status as string };
  const analysis = importMaps([inputFor(opts.group, kml, Buffer.byteLength(kml), digest)]);
  const counts = { fehler: 0, warnung: 0, info: 0 } as Record<string, number>;
  analysis.issues.forEach((i) => counts[i.severity]++);
  const row = await one<{ id: string }>(ctx.db, `INSERT INTO map_version(season_year, map_group, source, source_name, sha256, bytes, kml, status, stats, issue_counts, created_by, note)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'entwurf',$8,$9,$10,$11) RETURNING id`,
    [opts.season, opts.group, opts.source === 'kml_upload' && format === 'kmz' ? 'kmz_upload' : opts.source, opts.sourceName ?? null, digest, Buffer.byteLength(kml), kml,
      JSON.stringify(analysis.stats[0]), JSON.stringify(counts), opts.actor.personId, opts.note ?? null]);
  await audit(ctx.db, opts.actor, 'kartenversion_importiert', 'map_version', row!.id, { karte: opts.group, saison: opts.season, quelle: opts.source, sha256: digest, objekte: analysis.stats[0].objects, befunde: counts });
  invalidateBundles();
  return { id: row!.id, duplicate: false, status: 'entwurf' };
}

export async function activateVersion(ctx: AppContext, id: string, actor: Actor, opts: { verifiedBase?: boolean } = {}) {
  await tx(ctx.db, async (c) => {
    const v = await one<any>(c, 'SELECT id, map_group, season_year, status FROM map_version WHERE id = $1 FOR UPDATE', [id]);
    if (!v) throw new HttpError(404, 'not_found', 'Kartenversion nicht gefunden.');
    if (v.status === 'abgelehnt') throw new HttpError(409, 'rejected', 'Abgelehnte Versionen können nicht aktiviert werden.');
    await q(c, `UPDATE map_version SET status='archiviert' WHERE map_group=$1 AND season_year=$2 AND status='aktiv' AND id <> $3`, [v.map_group, v.season_year, id]);
    await q(c, `UPDATE map_version SET status='aktiv', activated_at=now(), activated_by=$2, is_verified_base = is_verified_base OR $3 WHERE id=$1`, [id, actor.personId, !!opts.verifiedBase]);
    await audit(c, actor, 'kartenversion_aktiviert', 'map_version', id, { karte: v.map_group, saison: v.season_year, alsGepruefteBasis: !!opts.verifiedBase });
  });
  invalidateBundles();
}

export async function rejectVersion(ctx: AppContext, id: string, actor: Actor) {
  const r = await q(ctx.db, `UPDATE map_version SET status='abgelehnt' WHERE id=$1 AND status='entwurf' RETURNING id`, [id]);
  if (!r.length) throw new HttpError(409, 'not_draft', 'Nur Entwürfe können abgelehnt werden.');
  await audit(ctx.db, actor, 'kartenversion_abgelehnt', 'map_version', id);
}

/** Rückkehr zur letzten gültigen (zuvor aktiven) Version. */
export async function rollback(ctx: AppContext, group: MapGroup, season: number, actor: Actor) {
  const prev = await one<any>(ctx.db, `SELECT id FROM map_version WHERE map_group=$1 AND season_year=$2 AND status='archiviert' AND activated_at IS NOT NULL ORDER BY activated_at DESC LIMIT 1`, [group, season]);
  if (!prev) throw new HttpError(409, 'no_previous', 'Es gibt keine frühere gültige Version.');
  await activateVersion(ctx, prev.id, actor);
  await audit(ctx.db, actor, 'kartenversion_zurueckgesetzt', 'map_version', prev.id, { karte: group });
  return prev.id as string;
}

// ---------------------------------------------------------------- Bundle für die App

export interface MapBundle {
  group: MapGroup;
  title: string;
  season: number;
  versionId: string | null;
  sha256: string | null;
  verifiedBase: boolean;
  activatedAt: string | null;
  etag: string;
  layerRules: Record<string, { label: string; meaning: string; status: string; fishingAllowed: boolean | null }>;
  closures: Closure[];
  sections: Section[];
}

let bundleCache: { key: string; result: ImportResult; versions: any[] } | null = null;
export function invalidateBundles() { bundleCache = null; }

export async function layerRules(db: Queryable) {
  const rows = await q<any>(db, 'SELECT * FROM layer_rule');
  const out: MapBundle['layerRules'] = {};
  for (const [k, r] of Object.entries(LAYER_RULES)) out[k] = { label: r.label, meaning: r.meaning, status: r.status, fishingAllowed: r.fishingAllowed };
  for (const r of rows) out[r.layer_kind] = { label: r.label, meaning: r.meaning, status: r.status, fishingAllowed: r.fishing_allowed };
  return out;
}

export async function activeAnalysis(ctx: AppContext, season: number) {
  const versions = await q<any>(ctx.db, `SELECT id, map_group, sha256, bytes, kml, activated_at, is_verified_base FROM map_version WHERE season_year=$1 AND status='aktiv'`, [season]);
  const dec = await one<any>(ctx.db, 'SELECT count(*) AS n, max(decided_at) AS m FROM map_issue_decision WHERE season_year=$1', [season]);
  const key = `${season}|${versions.map((v) => v.id).sort().join(',')}|${dec?.n}|${dec?.m}`;
  if (bundleCache?.key === key) return bundleCache;
  const decisions = await decisionsFor(ctx.db, season);
  const result = importMaps(versions.map((v) => inputFor(v.map_group, v.kml, v.bytes, v.sha256)), decisions);
  bundleCache = { key, result, versions };
  return bundleCache;
}

export async function mapBundle(ctx: AppContext, group: MapGroup, season: number): Promise<MapBundle> {
  const { result, versions } = await activeAnalysis(ctx, season);
  const v = versions.find((x) => x.map_group === group);
  const rules = await layerRules(ctx.db);
  const closures = (await q<any>(ctx.db, `SELECT * FROM closure WHERE status='active' AND (map_groups IS NULL OR $1 = ANY(map_groups))`, [group])).map(closureDto);
  const sections = result.sections.filter((s) => s.group === group).map((s) => applyLayerRule(s, rules));
  const title = MAP_GROUPS.find((g) => g.key === group)!.title;
  const etag = hash53(JSON.stringify([v?.sha256, rules, closures.map((c) => [c.id, c.from, c.to, c.status]), sections.map((s) => s.name + s.ruleText + s.ruleStatus)]));
  return {
    group, title, season, versionId: v?.id ?? null, sha256: v?.sha256 ?? null, verifiedBase: !!v?.is_verified_base,
    activatedAt: v?.activated_at ? new Date(v.activated_at).toISOString() : null, etag, layerRules: rules, closures, sections,
  };
}

function applyLayerRule(s: Section, rules: MapBundle['layerRules']): Section {
  if (s.kind !== 'water' || s.conflict) return s;
  const r = rules[s.layerKind as LayerKind];
  if (!r) return s;
  return { ...s, ruleLabel: r.label, ruleMeaning: r.meaning, ruleStatus: r.status as Section['ruleStatus'], fishingAllowed: s.layerKind === 'closed' ? false : r.fishingAllowed };
}

export function closureDto(r: any): Closure {
  return { id: r.id, waterKey: r.water_key, sectionIds: r.section_ids, groups: r.map_groups, from: r.date_from, to: r.date_to, reason: r.reason, status: r.status };
}

/** Analyse einer einzelnen Version (Vorschau/Importbericht vor dem Aktivieren). */
export async function versionReport(ctx: AppContext, id: string) {
  const v = await one<any>(ctx.db, 'SELECT * FROM map_version WHERE id=$1', [id]);
  if (!v) throw new HttpError(404, 'not_found', 'Kartenversion nicht gefunden.');
  const decisions = await decisionsFor(ctx.db, v.season_year);
  // Querbezüge (Schreibvarianten über Karten) mit den anderen aktiven Karten der Saison prüfen
  const others = await q<any>(ctx.db, `SELECT map_group, kml, bytes, sha256 FROM map_version WHERE season_year=$1 AND status='aktiv' AND map_group <> $2`, [v.season_year, v.map_group]);
  const r = importMaps([inputFor(v.map_group, v.kml, v.bytes, v.sha256), ...others.map((o) => inputFor(o.map_group, o.kml, o.bytes, o.sha256))], decisions);
  const active = await one<any>(ctx.db, `SELECT id, sha256, kml, bytes FROM map_version WHERE season_year=$1 AND map_group=$2 AND status='aktiv'`, [v.season_year, v.map_group]);
  let diff = null;
  if (active && active.id !== v.id) {
    const a = importMaps([inputFor(v.map_group, active.kml, active.bytes, active.sha256)]).sections;
    const b = r.sections.filter((s) => s.group === v.map_group);
    const ida = new Set(a.map((s) => s.id)), idb = new Set(b.map((s) => s.id));
    diff = {
      added: b.filter((s) => !ida.has(s.id)).map((s) => ({ id: s.id, name: s.name, layer: s.layerName })),
      removed: a.filter((s) => !idb.has(s.id)).map((s) => ({ id: s.id, name: s.name, layer: s.layerName })),
    };
  }
  return {
    version: { id: v.id, group: v.map_group, season: v.season_year, status: v.status, sha256: v.sha256, bytes: v.bytes, source: v.source, sourceName: v.source_name, createdAt: v.created_at, activatedAt: v.activated_at, verifiedBase: v.is_verified_base, note: v.note },
    stats: r.stats.find((s) => s.group === v.map_group),
    issues: r.issues.filter((i) => i.maps.includes(v.map_group)),
    diffToActive: diff,
    preview: r.sections.filter((s) => s.group === v.map_group).map((s) => ({ id: s.id, name: s.name, kind: s.kind, layerKind: s.layerKind, closed: s.closed, geometry: s.geometry, color: s.color })),
  };
}

export async function decideIssue(ctx: AppContext, season: number, issueId: string, status: 'bestaetigt' | 'abgelehnt' | 'offen', value: string | null, note: string | null, actor: Actor) {
  const { result } = await activeAnalysis(ctx, season);
  const issue = result.issues.find((i) => i.id === issueId);
  if (!issue) throw new HttpError(404, 'not_found', 'Befund nicht gefunden (nur Befunde aktiver Kartenversionen).');
  if (status === 'bestaetigt' && issue.normalizable && !issue.suggestion && !value?.trim()) {
    throw new HttpError(400, 'value_required', 'Für diesen Befund gibt es keinen Vorschlag – bitte den richtigen Wert eintragen.');
  }
  await q(ctx.db, `INSERT INTO map_issue_decision(issue_id, season_year, status, value, note, decided_by) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (issue_id, season_year) DO UPDATE SET status=EXCLUDED.status, value=EXCLUDED.value, note=EXCLUDED.note, decided_by=EXCLUDED.decided_by, decided_at=now()`,
    [issueId, season, status, value?.trim() || null, note, actor.personId]);
  await audit(ctx.db, actor, 'importbefund_entschieden', 'map_issue', issueId, { status, original: issue.original, vorschlag: issue.suggestion, wert: value, art: issue.kind });
  invalidateBundles();
}

// ---------------------------------------------------------------- Tägliche Aktualitätsprüfung

export async function checkNetworkLinks(ctx: AppContext, actor: Actor = SYSTEM) {
  const season = await getSetting<number>(ctx.db, 'season.current_year');
  const sources = await q<any>(ctx.db, 'SELECT * FROM map_source WHERE season_year=$1 AND active ORDER BY map_group', [season]);
  const results: any[] = [];
  const desc = ctx.mymaps.describe();
  for (const s of sources) {
    if (!desc.configured || !s.my_maps_id) {
      await q(ctx.db, `INSERT INTO map_check(map_group, season_year, result, message) VALUES ($1,$2,'nicht_eingerichtet',$3)`, [s.map_group, season, desc.detail]);
      results.push({ group: s.map_group, result: 'nicht_eingerichtet' });
      continue;
    }
    try {
      const buf = await ctx.mymaps.fetch(s.my_maps_id);
      const { kml } = await kmlFromBuffer(buf);
      const digest = sha(kml);
      const latest = await one<any>(ctx.db, 'SELECT id, sha256 FROM map_version WHERE map_group=$1 AND season_year=$2 ORDER BY created_at DESC LIMIT 1', [s.map_group, season]);
      if (latest && latest.sha256 === digest) {
        await q(ctx.db, `INSERT INTO map_check(map_group, season_year, result, sha256, map_version_id) VALUES ($1,$2,'unveraendert',$3,$4)`, [s.map_group, season, digest, latest.id]);
        results.push({ group: s.map_group, result: 'unveraendert', sha256: digest });
        continue;
      }
      const imp = await importVersion(ctx, { group: s.map_group, season, buffer: Buffer.from(kml), source: 'network_link', sourceName: `My Maps ${s.my_maps_id}`, actor, note: 'Automatisch bei der täglichen Aktualitätsprüfung erkannt' });
      await q(ctx.db, `INSERT INTO map_check(map_group, season_year, result, sha256, map_version_id, message) VALUES ($1,$2,'geaendert',$3,$4,$5)`,
        [s.map_group, season, digest, imp.id, imp.duplicate ? 'Stand entspricht einer älteren Version' : 'Neue Version als Entwurf gespeichert']);
      const active = await one<any>(ctx.db, `SELECT id FROM map_version WHERE map_group=$1 AND season_year=$2 AND status='aktiv'`, [s.map_group, season]);
      if (!active || (await getSetting<boolean>(ctx.db, 'map.auto_activate'))) await activateVersion(ctx, imp.id, actor);
      await notifyAdmins(ctx, `Gewässerkarte «${s.title}» geändert`, `Die tägliche Prüfung hat einen geänderten Stand in Google My Maps gefunden (SHA-256 ${digest.slice(0, 12)}…). Die neue Version wurde als ${active ? 'Entwurf gespeichert und muss im Adminbereich geprüft und aktiviert werden' : 'erste Version aktiviert'}.`);
      results.push({ group: s.map_group, result: 'geaendert', versionId: imp.id });
    } catch (e: any) {
      await q(ctx.db, `INSERT INTO map_check(map_group, season_year, result, message) VALUES ($1,$2,'fehler',$3)`, [s.map_group, season, e.message]);
      await recordError(ctx.db, 'mymaps', `Abruf «${s.title}» fehlgeschlagen: ${e.message}`);
      await notifyAdmins(ctx, `Kartenprüfung fehlgeschlagen: ${s.title}`, `${e.message}\nDie letzte gespeicherte Version bleibt gültig.`);
      results.push({ group: s.map_group, result: 'fehler', message: e.message });
    }
  }
  if (results.length && results.every((r) => r.result !== 'fehler' && r.result !== 'nicht_eingerichtet')) await recordSuccess(ctx.db, 'mymaps', `Kartenprüfung: ${results.map((r) => `${r.group} ${r.result}`).join(', ')}`);
  return results;
}

export async function notifyAdmins(ctx: AppContext, subject: string, body: string) {
  await logIntegration(ctx.db, 'mymaps', 'info', subject, { body });
  const to = await getSetting<string | null>(ctx.db, 'recipients.admin_alerts');
  if (to) await ctx.mail.send({ kind: 'admin_hinweis', to, subject, body });
}
