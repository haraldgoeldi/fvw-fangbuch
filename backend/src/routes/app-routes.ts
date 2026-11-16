import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { catchesToCsv, MAP_GROUPS, zurichDate, type MapGroup } from '@fvw/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { actorOf, authMiddleware, has, HttpError, principal, requirePerm, type Env } from '../authz';
import type { AppContext } from '../context';
import { one, q } from '../db';
import { INTEGRATION_LABELS } from '../integrations/status';
import { getSetting } from '../settings';
import { emailForTicket, loginWithAccessCode, requestLoginCode, verifyLoginCode } from '../services/accounts';
import { speciesNames, watersFor } from '../services/catalog';
import { eventIcs, listEvents, listNews, newsInput, saveNews } from '../services/content';
import { layerRules, mapBundle } from '../services/maps';
import { allowedGroups, permitsOf, revokedCredentialCodes } from '../services/permits';
import { openReportsFor } from '../services/returns';
import { applyOps, catchDto, pull, pushSchema, tourDto } from '../services/sync';

const BASEMAP_DIR = resolve(import.meta.dirname, '../../../data/basemap');
const basemapFiles: Record<string, string> = { basis: 'lk25-werdenberg-basis.mbtiles', detail: 'lk25-werdenberg-detail.mbtiles' };
const tileDbs = new Map<string, DatabaseSync>();
function tileDb(variant: string) {
  const f = resolve(BASEMAP_DIR, basemapFiles[variant] ?? '');
  if (!basemapFiles[variant] || !existsSync(f)) return null;
  if (!tileDbs.has(f)) tileDbs.set(f, new DatabaseSync(f, { readOnly: true }));
  return tileDbs.get(f)!;
}

export function publicRoutes(ctx: AppContext) {
  const r = new Hono<Env>();
  r.get('/health', async (c) => {
    await q(ctx.db, 'SELECT 1');
    return c.json({ ok: true, time: ctx.now().toISOString() });
  });
  r.get('/public/config', (c) => c.json({
    demoMode: ctx.cfg.DEMO_MODE, credentialPublicKey: ctx.signer.publicKeyB64, credentialKeyEphemeral: ctx.signer.ephemeral,
    basemapAttribution: '© Data: swisstopo', environment: ctx.cfg.NODE_ENV,
  }));
  // ---------- Anmeldung (Einmal-Code über Better Auth)
  r.post('/auth/request-code', async (c) => {
    const body = z.object({ email: z.string().trim().email().optional(), ticketNo: z.string().trim().min(3).max(60).optional() }).parse(await c.req.json());
    let email = body.email ?? null;
    if (!email && body.ticketNo) email = await emailForTicket(ctx, body.ticketNo);
    if (email) await requestLoginCode(ctx, email);
    // Einheitliche Antwort: verrät nicht, ob eine E-Mail registriert ist (Datenschutz)
    return c.json({
      ok: true,
      message: 'Falls die Angaben zu einem berechtigten Mitglied oder einer gültigen Tageskarte gehören, wurde ein 6-stelliger Code an die hinterlegte E-Mail-Adresse gesendet.',
      emailHint: body.ticketNo && email ? email.replace(/^(.).*(@.*)$/, '$1…$2') : undefined,
      demoMode: ctx.cfg.DEMO_MODE,
    });
  });
  r.post('/auth/verify-code', async (c) => {
    const body = z.object({ email: z.string().trim().email().optional(), ticketNo: z.string().optional(), code: z.string().trim().regex(/^\d{6}$/, 'Bitte den 6-stelligen Code eingeben.'), device: z.string().max(100).optional() }).parse(await c.req.json());
    const email = body.email ?? (body.ticketNo ? await emailForTicket(ctx, body.ticketNo) : null);
    if (!email) throw new HttpError(400, 'invalid_code', 'Der Code ist ungültig oder abgelaufen.');
    const { token } = await verifyLoginCode(ctx, email, body.code, body.device ?? null);
    return c.json({ token, sessionDays: ctx.cfg.SESSION_DAYS });
  });
  r.post('/auth/access-code', async (c) => {
    const body = z.object({ code: z.string().trim().min(6).max(20) }).parse(await c.req.json());
    return c.json({ ...(await loginWithAccessCode(ctx, body.code)), sessionDays: ctx.cfg.SESSION_DAYS });
  });
  r.post('/auth/logout', async (c) => {
    try { await ctx.auth.api.signOut({ headers: c.req.raw.headers }); } catch { /* bereits abgemeldet */ }
    return c.json({ ok: true });
  });
  // ---------- Demo-Hilfen (nur DEMO_MODE, nie in Produktion)
  r.get('/demo/mailbox', async (c) => {
    if (!ctx.cfg.DEMO_MODE) throw new HttpError(404, 'not_found', 'Nicht verfügbar');
    const email = (c.req.query('email') ?? '').trim().toLowerCase();
    const rows = await q<any>(ctx.db, `SELECT id, kind, to_addr, subject, body, status, created_at FROM mail_outbox WHERE lower(to_addr)=$1 ORDER BY created_at DESC LIMIT 5`, [email]);
    return c.json(rows);
  });
  r.get('/demo/accounts', async (c) => {
    if (!ctx.cfg.DEMO_MODE) throw new HttpError(404, 'not_found', 'Nicht verfügbar');
    const rows = await q<any>(ctx.db, `SELECT email, display_name, kind, roles, eligible, fairgate_status FROM person WHERE source='demo' AND email IS NOT NULL ORDER BY kind, display_name`);
    return c.json(rows);
  });
  // ---------- Basiskarte (Offline-Paket)
  r.get('/basemap/:variant/manifest', (c) => {
    const f = resolve(BASEMAP_DIR, `${basemapFiles[c.req.param('variant')] ?? 'x'}.json`);
    if (!existsSync(f)) throw new HttpError(404, 'not_found', 'Kartenpaket nicht vorhanden');
    return c.json(JSON.parse(readFileSync(f, 'utf8')));
  });
  r.get('/basemap/:variant/file', (c) => {
    const name = basemapFiles[c.req.param('variant')];
    const f = name && resolve(BASEMAP_DIR, name);
    if (!f || !existsSync(f)) throw new HttpError(404, 'not_found', 'Kartenpaket nicht vorhanden');
    return new Response(readFileSync(f), { headers: { 'Content-Type': 'application/vnd.sqlite3', 'Content-Length': String(statSync(f).size), 'Cache-Control': 'public, max-age=86400' } });
  });
  r.get('/basemap/:variant/tiles/:z/:x/:y', (c) => {
    const dbt = tileDb(c.req.param('variant'));
    const z = Number(c.req.param('z')), x = Number(c.req.param('x')), y = Number(c.req.param('y').replace(/\.\w+$/, ''));
    if (!dbt) throw new HttpError(404, 'not_found', 'Kartenpaket nicht vorhanden');
    const row = dbt.prepare('SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?').get(z, x, (1 << z) - 1 - y) as any;
    if (!row) return c.body(null, 404);
    return new Response(Buffer.from(row.tile_data as Uint8Array) as unknown as BodyInit, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=604800' } });
  });
  return r;
}

export function appRoutes(ctx: AppContext) {
  const r = new Hono<Env>();
  r.use('*', authMiddleware(ctx));

  r.get('/bootstrap', async (c) => {
    const p = principal(c);
    const season = await getSetting<number>(ctx.db, 'season.current_year');
    const permits = await permitsOf(ctx, p.personId, p.displayName);
    const allowed = allowedGroups(p, permits);
    const maps = [];
    for (const g of allowed.groups) {
      const b = await mapBundle(ctx, g, season);
      maps.push({ group: g, title: b.title, etag: b.etag, versionId: b.versionId, activatedAt: b.activatedAt, verifiedBase: b.verifiedBase, sectionCount: b.sections.length });
    }
    const integrations = await q<any>(ctx.db, 'SELECT key, mode, detail, last_success_at, last_error_at, last_error FROM integration_status ORDER BY key');
    const decisions = await q<any>(ctx.db, `SELECT id, question, interim, status, decision FROM open_decision ORDER BY length(id), id`);
    const warden = has(p, 'permits.verify') ? { publicKey: ctx.signer.publicKeyB64, revoked: await revokedCredentialCodes(ctx.db), confirmationMethod: await getSetting(ctx.db, 'control.confirmation_method'), violationRequired: await getSetting(ctx.db, 'control.violation_required_fields') } : null;
    return c.json({
      serverTime: ctx.now().toISOString(), season,
      me: { personId: p.personId, kind: p.kind, displayName: p.displayName, email: p.email, memberNo: p.memberNo, roles: p.roles, permissions: p.permissions, accessUntil: p.accessUntil, sessionExpiresAt: p.sessionExpiresAt },
      permits, mapAccess: allowed, maps,
      species: await speciesNames(ctx.db),
      waters: await watersFor(ctx, p, allowed.groups, season),
      layerRules: await layerRules(ctx.db),
      settings: {
        permitCheck: await getSetting(ctx.db, 'tour.permit_check'),
        locationToleranceM: await getSetting(ctx.db, 'location.tolerance_m'),
        liveLocation: await getSetting(ctx.db, 'features.live_location'),
        guestGraceDays: await getSetting(ctx.db, 'guest.grace_days'),
      },
      openReports: await openReportsFor(ctx, p.personId),
      warden,
      integrations: integrations.map((i) => ({ ...i, label: INTEGRATION_LABELS[i.key as keyof typeof INTEGRATION_LABELS] ?? i.key })),
      decisions,
      basemap: { attribution: '© Data: swisstopo', variants: Object.keys(basemapFiles).filter((v) => existsSync(resolve(BASEMAP_DIR, basemapFiles[v]))) },
    });
  });

  r.get('/maps/:group', async (c) => {
    const p = principal(c);
    const group = c.req.param('group') as MapGroup;
    if (!MAP_GROUPS.some((g) => g.key === group)) throw new HttpError(404, 'not_found', 'Unbekannte Karte');
    const permits = await permitsOf(ctx, p.personId, p.displayName);
    if (!allowedGroups(p, permits).groups.includes(group)) throw new HttpError(403, 'forbidden', 'Diese Karte ist für Ihre Berechtigung nicht freigegeben.');
    const season = await getSetting<number>(ctx.db, 'season.current_year');
    const b = await mapBundle(ctx, group, season);
    if (c.req.header('if-none-match') === `"${b.etag}"`) return c.body(null, 304);
    c.header('ETag', `"${b.etag}"`);
    return c.json(b);
  });

  // ---------- Synchronisation
  r.post('/sync/push', async (c) => {
    const p = principal(c);
    const body = pushSchema.parse(await c.req.json());
    const results = await applyOps(ctx, p, body.deviceId, body.ops);
    return c.json({ serverTime: ctx.now().toISOString(), results });
  });
  r.get('/sync/pull', async (c) => c.json(await pull(ctx, principal(c), c.req.query('since') ?? null)));

  // ---------- Fotos (Meldungen, Kontrollen, Vergehen, News)
  r.post('/photos', async (c) => {
    const p = principal(c);
    const form = await c.req.formData();
    const id = String(form.get('id') ?? '');
    const purpose = String(form.get('purpose') ?? '');
    const file = form.get('file');
    if (!/^[0-9a-f-]{36}$/i.test(id) || !(file instanceof File)) throw new HttpError(400, 'invalid', 'Foto fehlt oder ungültige ID.');
    if (!['meldung', 'kontrolle', 'vergehen', 'news'].includes(purpose)) throw new HttpError(400, 'invalid', 'Ungültiger Zweck.');
    if ((purpose === 'kontrolle' || purpose === 'vergehen') && !has(p, 'controls.write')) throw new HttpError(403, 'forbidden', 'Keine Berechtigung.');
    if (purpose === 'news' && !has(p, 'news.write')) throw new HttpError(403, 'forbidden', 'Keine Berechtigung.');
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic'].includes(file.type)) throw new HttpError(415, 'type', 'Nur JPEG, PNG, WebP oder HEIC.');
    if (file.size > 8 * 1024 * 1024) throw new HttpError(413, 'too_large', 'Foto ist grösser als 8 MB.');
    const existing = await one<any>(ctx.db, 'SELECT id, owner_person_id FROM photo WHERE id=$1', [id]);
    if (existing) {
      if (existing.owner_person_id !== p.personId) throw new HttpError(409, 'conflict', 'ID bereits vergeben.');
      return c.json({ id, duplicate: true });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const dir = resolve(ctx.cfg.STORAGE_DIR, 'photos');
    await mkdir(dir, { recursive: true });
    const path = resolve(dir, id);
    await writeFile(path, buf);
    await q(ctx.db, `INSERT INTO photo(id, owner_person_id, purpose, mime, bytes, sha256, path) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, p.personId, purpose, file.type, buf.length, createHash('sha256').update(buf).digest('hex'), path]);
    return c.json({ id, duplicate: false });
  });
  r.get('/photos/:id', async (c) => {
    const p = principal(c);
    const ph = await one<any>(ctx.db, 'SELECT * FROM photo WHERE id=$1 AND deleted_at IS NULL', [c.req.param('id')]);
    if (!ph) throw new HttpError(404, 'not_found', 'Foto nicht gefunden');
    const allowed = ph.owner_person_id === p.personId || ph.purpose === 'news'
      || (ph.purpose === 'meldung' && has(p, 'admin.access')) || ((ph.purpose === 'kontrolle' || ph.purpose === 'vergehen') && has(p, 'controls.read_all'));
    if (!allowed) throw new HttpError(403, 'forbidden', 'Keine Berechtigung für dieses Foto.');
    return new Response(await readFile(ph.path), { headers: { 'Content-Type': ph.mime, 'Cache-Control': 'private, max-age=3600' } });
  });

  // ---------- Fangliste & CSV
  const listSchema = z.object({
    scope: z.enum(['mine', 'all']).default('mine'), from: z.string().optional(), to: z.string().optional(),
    water: z.string().optional(), species: z.string().optional(), person: z.string().uuid().optional(),
  });
  async function catchRows(c: any) {
    const p = principal(c);
    const f = listSchema.parse(c.req.query());
    if (f.scope === 'all' && !has(p, 'catches.read_all')) throw new HttpError(403, 'forbidden', 'Nur Vorstand/Admin darf die Fänge aller Mitglieder sehen.');
    const where = ['c.deleted_at IS NULL', 't.deleted_at IS NULL'];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (f.scope === 'mine') add('c.person_id = ?', p.personId);
    else if (f.person) add('c.person_id = ?', f.person);
    if (f.from) add(`c.caught_at >= ?::date`, f.from);
    if (f.to) add(`c.caught_at < ?::date + 1`, f.to);
    if (f.water) add('t.water_key = ?', f.water);
    if (f.species) add('c.species = ?', f.species);
    return q<any>(ctx.db, `SELECT c.*, t.water_name, t.water_key, t.started_at AS tour_started, per.display_name, per.member_no, per.kind AS person_kind, per.anonymized_at
      FROM catch c JOIN tour t ON t.id = c.tour_id JOIN person per ON per.id = c.person_id WHERE ${where.join(' AND ')} ORDER BY c.caught_at DESC LIMIT 5000`, params);
  }
  const memberLabel = (r: any) => (r.anonymized_at ? (r.person_kind === 'guest' ? 'Gast (anonymisiert)' : 'anonymisiert') : `${r.display_name}${r.person_kind === 'guest' ? ' (Gast)' : ''}`);
  r.get('/catches', async (c) => {
    const rows = await catchRows(c);
    return c.json(rows.map((r) => ({ ...catchDto(r), waterName: r.water_name, waterKey: r.water_key, member: memberLabel(r), personId: r.person_id })));
  });
  r.get('/catches.csv', async (c) => {
    const p = principal(c);
    const scope = c.req.query('scope') ?? 'mine';
    if (!has(p, scope === 'all' ? 'catches.export_all' : 'catches.export_own')) throw new HttpError(403, 'forbidden', 'Keine Berechtigung für den Export.');
    const rows = await catchRows(c);
    const csv = catchesToCsv(rows.map((r) => ({ caughtAt: new Date(r.caught_at).toISOString(), memberName: memberLabel(r), waterName: r.water_name, species: r.species, lengthCm: r.length_cm, disposition: r.disposition })));
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="faenge-${scope === 'all' ? 'alle' : 'meine'}-${zurichDate(ctx.now())}.csv"` } });
  });

  // ---------- News, Termine
  r.get('/news', async (c) => c.json(await listNews(ctx, principal(c))));
  r.post('/news', requirePerm('news.write'), async (c) => c.json(await saveNews(ctx, actorOf(principal(c)), newsInput.parse(await c.req.json()))));
  r.get('/events', async (c) => c.json(await listEvents(ctx)));
  r.get('/events/:id/ics', async (c) => {
    const e = (await listEvents(ctx)).find((x) => x.id === c.req.param('id'));
    if (!e) throw new HttpError(404, 'not_found', 'Termin nicht gefunden');
    return new Response(eventIcs(e), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="termin.ics"` } });
  });

  // ---------- Saisonmeldung «nicht gefischt» (Vorschlag)
  r.post('/season-report', async (c) => {
    const p = principal(c);
    if (p.kind !== 'member') throw new HttpError(403, 'forbidden', 'Nur für Mitglieder.');
    const body = z.object({ id: z.string().uuid(), season: z.number().int() }).parse(await c.req.json());
    await q(ctx.db, `INSERT INTO season_report(id, person_id, season_year, kind) VALUES ($1,$2,$3,'nicht_gefischt') ON CONFLICT DO NOTHING`, [body.id, p.personId, body.season]);
    return c.json({ ok: true });
  });

  // ---------- Push-Token (nur gespeichert, Versand nur bei aktivem Push-Dienst)
  r.post('/push-token', async (c) => {
    const p = principal(c);
    const body = z.object({ token: z.string().min(10).max(300), platform: z.string().max(20).optional() }).parse(await c.req.json());
    await q(ctx.db, `INSERT INTO push_device(token, person_id, platform) VALUES ($1,$2,$3) ON CONFLICT (token) DO UPDATE SET person_id=EXCLUDED.person_id`, [body.token, p.personId, body.platform ?? null]);
    return c.json({ ok: true });
  });

  // ---------- Meine Daten (Export, Löschantrag)
  r.get('/me/export', async (c) => {
    const p = principal(c);
    const person = await one<any>(ctx.db, 'SELECT id, kind, email, display_name, member_no, fairgate_status, roles, created_at FROM person WHERE id=$1', [p.personId]);
    const tours = (await q<any>(ctx.db, 'SELECT * FROM tour WHERE person_id=$1', [p.personId])).map(tourDto);
    const catches = (await q<any>(ctx.db, 'SELECT * FROM catch WHERE person_id=$1', [p.personId])).map(catchDto);
    const permits = await permitsOf(ctx, p.personId, p.displayName);
    const reports = await q<any>(ctx.db, 'SELECT id, kind, description, water_name, location, observed_at, created_at FROM incident_report WHERE person_id=$1', [p.personId]);
    const registrations = await q<any>(ctx.db, 'SELECT id, event_id, participants, message, created_at FROM event_registration WHERE person_id=$1', [p.personId]);
    c.header('Content-Disposition', `attachment; filename="meine-daten-${zurichDate(ctx.now())}.json"`);
    return c.json({ exportiertAm: ctx.now().toISOString(), person, permits: permits.map(({ credentialToken: _t, ...x }) => x), tours, catches, reports, registrations });
  });
  r.post('/me/deletion-request', async (c) => {
    const p = principal(c);
    const open = await one(ctx.db, `SELECT id FROM deletion_request WHERE person_id=$1 AND status='offen'`, [p.personId]);
    if (!open) await q(ctx.db, `INSERT INTO deletion_request(person_id) VALUES ($1)`, [p.personId]);
    return c.json({ ok: true, message: 'Ihr Löschantrag wurde erfasst. Der Vorstand prüft, welche Daten gelöscht werden dürfen (z. B. Aufbewahrungspflichten), und meldet sich.' });
  });

  // ---------- Kurzübersicht für den Adminbereich in der App
  r.get('/admin-summary', requirePerm('admin.access'), async (c) => {
    const season = await getSetting<number>(ctx.db, 'season.current_year');
    const versions = await q<any>(ctx.db, `SELECT map_group, status, sha256, activated_at, is_verified_base FROM map_version WHERE season_year=$1 AND status IN ('aktiv','entwurf') ORDER BY created_at DESC`, [season]);
    const pending = await one<any>(ctx.db, `SELECT
      (SELECT count(*) FROM water WHERE status='ungeprueft') AS waters,
      (SELECT count(*) FROM sync_conflict WHERE resolved_at IS NULL) AS conflicts,
      (SELECT count(*) FROM deletion_request WHERE status='offen') AS deletions,
      (SELECT count(*) FROM open_decision WHERE status='offen') AS decisions,
      (SELECT count(*) FROM mail_outbox WHERE status IN ('entwurf','ausstehend','fehler')) AS mails`);
    const lastCheck = await q<any>(ctx.db, `SELECT DISTINCT ON (map_group) map_group, checked_at, result, message FROM map_check ORDER BY map_group, checked_at DESC`);
    return c.json({ versions, pending, lastCheck, adminWebUrl: `${ctx.cfg.PUBLIC_BASE_URL}/admin/` });
  });

  // ---------- Aufseher: Online-Prüfung eines Ausweises (zusätzlich zur Offline-Prüfung)
  r.get('/warden/credential/:code', requirePerm('permits.verify'), async (c) => {
    const row = await one<any>(ctx.db, `SELECT p.status, p.valid_from, p.valid_to, t.name FROM permit p JOIN permit_type t ON t.id=p.permit_type_id WHERE p.credential_code=$1`, [c.req.param('code')]);
    if (!row) return c.json({ found: false });
    const today = zurichDate(ctx.now());
    return c.json({ found: true, status: row.status, typeName: row.name, validFrom: row.valid_from, validTo: row.valid_to, valid: row.status === 'aktiv' && row.valid_from <= today && today <= row.valid_to });
  });
  return r;
}
