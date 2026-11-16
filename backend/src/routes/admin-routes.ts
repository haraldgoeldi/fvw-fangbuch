import { LAYER_RULES, MAP_GROUPS, ROLE_PERMISSIONS, type MapGroup, type Permission } from '@fvw/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { audit } from '../audit';
import { actorOf, authMiddleware, HttpError, principal, requirePerm, revokeSessions, rolesOf, type Env } from '../authz';
import type { AppContext } from '../context';
import { one, q, tx } from '../db';
import { INTEGRATION_LABELS } from '../integrations/status';
import { getAllSettings, getSetting, setSetting, validateSetting } from '../settings';
import { createAccessCode, newCredentialCode, syncGuestOrders, syncMembers } from '../services/accounts';
import { deleteNews, newsDto, newsInput, saveNews, syncEvents } from '../services/content';
import { activateVersion, activeAnalysis, checkNetworkLinks, closureDto, decideIssue, importVersion, invalidateBundles, layerRules, rejectVersion, rollback, versionReport } from '../services/maps';
import { anonymizePerson, applyRetention, returnRates } from '../services/returns';
import { refreshIntegrationStatus } from '../cli/migrate';

const ALL_PERMISSIONS = [...new Set(Object.values(ROLE_PERMISSIONS).flat())].sort() as Permission[];

export function adminRoutes(ctx: AppContext) {
  const r = new Hono<Env>();
  r.use('*', authMiddleware(ctx), requirePerm('admin.access'));
  const season = () => getSetting<number>(ctx.db, 'season.current_year');

  r.get('/overview', async (c) => {
    const s = await season();
    const counts = await one<any>(ctx.db, `SELECT
      (SELECT count(*) FROM person WHERE kind='member' AND eligible) AS members,
      (SELECT count(*) FROM person WHERE kind='guest' AND anonymized_at IS NULL) AS guests,
      (SELECT count(*) FROM tour WHERE deleted_at IS NULL) AS tours,
      (SELECT count(*) FROM catch WHERE deleted_at IS NULL) AS catches,
      (SELECT count(*) FROM control) AS controls,
      (SELECT count(*) FROM incident_report) AS reports,
      (SELECT count(*) FROM water WHERE status='ungeprueft') AS water_suggestions,
      (SELECT count(*) FROM sync_conflict WHERE resolved_at IS NULL) AS conflicts,
      (SELECT count(*) FROM deletion_request WHERE status='offen') AS deletion_requests,
      (SELECT count(*) FROM open_decision WHERE status='offen') AS open_decisions,
      (SELECT count(*) FROM mail_outbox WHERE status='entwurf') AS mail_drafts,
      (SELECT count(*) FROM mail_outbox WHERE status='fehler') AS mail_errors`);
    const integrations = await q<any>(ctx.db, 'SELECT * FROM integration_status ORDER BY key');
    const versions = await q<any>(ctx.db, `SELECT id, map_group, status, sha256, bytes, source, created_at, activated_at, is_verified_base, issue_counts FROM map_version WHERE season_year=$1 AND status IN ('aktiv','entwurf') ORDER BY map_group, created_at DESC`, [s]);
    const checks = await q<any>(ctx.db, `SELECT DISTINCT ON (map_group) map_group, checked_at, result, sha256, message FROM map_check WHERE season_year=$1 ORDER BY map_group, checked_at DESC`, [s]);
    return c.json({ season: s, counts, integrations: integrations.map((i) => ({ ...i, label: INTEGRATION_LABELS[i.key as keyof typeof INTEGRATION_LABELS] })), versions, checks, demoMode: ctx.cfg.DEMO_MODE });
  });

  // ---------------------------------------------------------------- Karten
  r.get('/maps', requirePerm('admin.maps'), async (c) => {
    const s = Number(c.req.query('season') ?? (await season()));
    const sources = await q<any>(ctx.db, 'SELECT * FROM map_source WHERE season_year=$1 ORDER BY map_group', [s]);
    const versions = await q<any>(ctx.db, `SELECT id, map_group, status, sha256, bytes, source, source_name, created_at, activated_at, is_verified_base, issue_counts, stats->>'objects' AS objects, note FROM map_version WHERE season_year=$1 ORDER BY created_at DESC`, [s]);
    const checks = await q<any>(ctx.db, `SELECT * FROM map_check WHERE season_year=$1 ORDER BY checked_at DESC LIMIT 60`, [s]);
    return c.json({ season: s, sources, versions, checks });
  });
  r.post('/maps/upload', requirePerm('admin.maps'), async (c) => {
    const form = await c.req.formData();
    const group = String(form.get('group')) as MapGroup;
    const file = form.get('file');
    if (!MAP_GROUPS.some((g) => g.key === group) || !(file instanceof File)) throw new HttpError(400, 'invalid', 'Karte und Datei angeben.');
    const res = await importVersion(ctx, { group, season: Number(form.get('season') ?? (await season())), buffer: Buffer.from(await file.arrayBuffer()), source: 'kml_upload', sourceName: file.name, actor: actorOf(principal(c)), note: String(form.get('note') ?? '') || undefined });
    return c.json(res);
  });
  r.post('/maps/check', requirePerm('admin.maps'), async (c) => c.json(await checkNetworkLinks(ctx, actorOf(principal(c)))));
  r.get('/maps/versions/:id/report', requirePerm('admin.maps'), async (c) => c.json(await versionReport(ctx, c.req.param('id'))));
  r.post('/maps/versions/:id/activate', requirePerm('admin.maps'), async (c) => {
    const body = z.object({ verifiedBase: z.boolean().default(false) }).parse(await c.req.json().catch(() => ({})));
    await activateVersion(ctx, c.req.param('id'), actorOf(principal(c)), body);
    return c.json({ ok: true });
  });
  r.post('/maps/versions/:id/reject', requirePerm('admin.maps'), async (c) => { await rejectVersion(ctx, c.req.param('id'), actorOf(principal(c))); return c.json({ ok: true }); });
  r.post('/maps/rollback', requirePerm('admin.maps'), async (c) => {
    const body = z.object({ group: z.enum(['aktive', 'jugend', 'tageskarte']) }).parse(await c.req.json());
    return c.json({ activated: await rollback(ctx, body.group, await season(), actorOf(principal(c))) });
  });
  r.put('/maps/sources/:id', requirePerm('admin.maps'), async (c) => {
    const body = z.object({ title: z.string().min(2), myMapsId: z.string().regex(/^[A-Za-z0-9_-]+$/).nullable(), active: z.boolean() }).parse(await c.req.json());
    await q(ctx.db, `UPDATE map_source SET title=$2, my_maps_id=$3, network_link_url=CASE WHEN $3::text IS NULL THEN NULL ELSE 'https://www.google.com/maps/d/u/0/kml?mid=' || $3 END, active=$4 WHERE id=$1`, [c.req.param('id'), body.title, body.myMapsId, body.active]);
    await audit(ctx.db, actorOf(principal(c)), 'kartenquelle_geaendert', 'map_source', c.req.param('id'), body);
    return c.json({ ok: true });
  });
  r.post('/maps/sources', requirePerm('admin.maps'), async (c) => {
    const body = z.object({ seasonYear: z.number().int().min(2026).max(2100), group: z.enum(['aktive', 'jugend', 'tageskarte']), title: z.string().min(2), myMapsId: z.string().regex(/^[A-Za-z0-9_-]+$/).nullable() }).parse(await c.req.json());
    await q(ctx.db, `INSERT INTO season(year, label) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [body.seasonYear, `Saison ${body.seasonYear}`]);
    await q(ctx.db, `INSERT INTO map_source(season_year, map_group, title, my_maps_id, network_link_url) VALUES ($1,$2,$3,$4, CASE WHEN $4::text IS NULL THEN NULL ELSE 'https://www.google.com/maps/d/u/0/kml?mid=' || $4 END)
      ON CONFLICT (season_year, map_group) DO UPDATE SET title=EXCLUDED.title, my_maps_id=EXCLUDED.my_maps_id, network_link_url=EXCLUDED.network_link_url`, [body.seasonYear, body.group, body.title, body.myMapsId]);
    await audit(ctx.db, actorOf(principal(c)), 'kartenquelle_erfasst', 'map_source', null, body);
    return c.json({ ok: true });
  });
  r.get('/maps/issues', requirePerm('admin.maps'), async (c) => {
    const { result } = await activeAnalysis(ctx, await season());
    const dec = await q<any>(ctx.db, `SELECT d.issue_id, d.value, d.note, d.decided_at, p.display_name FROM map_issue_decision d LEFT JOIN person p ON p.id=d.decided_by WHERE season_year=$1`, [await season()]);
    const dm = new Map(dec.map((d) => [d.issue_id, d]));
    return c.json({ stats: result.stats, issues: result.issues.map((i) => ({ ...i, decision: dm.get(i.id) ?? null })) });
  });
  r.post('/maps/issues/:id/decision', requirePerm('admin.maps'), async (c) => {
    const body = z.object({ status: z.enum(['bestaetigt', 'abgelehnt', 'offen']), value: z.string().max(300).nullable().optional(), note: z.string().max(1000).nullable().optional() }).parse(await c.req.json());
    await decideIssue(ctx, await season(), decodeURIComponent(c.req.param('id')), body.status, body.value ?? null, body.note ?? null, actorOf(principal(c)));
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- Regeln, Sperrzeiten, Gewässer, Fischarten
  r.get('/rules', requirePerm('admin.rules'), async (c) => {
    const current = await layerRules(ctx.db);
    const rows = await q<any>(ctx.db, 'SELECT layer_kind, version, updated_at FROM layer_rule');
    const meta = new Map(rows.map((r) => [r.layer_kind, r]));
    return c.json(Object.entries(current).map(([kind, v]) => ({ kind, ...v, defaults: (LAYER_RULES as any)[kind], version: meta.get(kind)?.version ?? 0, updatedAt: meta.get(kind)?.updated_at ?? null, decisionRef: (LAYER_RULES as any)[kind]?.decisionRef ?? null })));
  });
  r.put('/rules/:kind', requirePerm('admin.rules'), async (c) => {
    const kind = c.req.param('kind');
    if (!(kind in LAYER_RULES)) throw new HttpError(404, 'not_found', 'Unbekannte Ebene');
    const body = z.object({ label: z.string().min(2).max(200), meaning: z.string().min(2).max(2000), status: z.enum(['from_source', 'needs_board', 'imported_text_only', 'display_only']), fishingAllowed: z.boolean().nullable() }).parse(await c.req.json());
    const before = (await layerRules(ctx.db))[kind];
    await q(ctx.db, `INSERT INTO layer_rule(layer_kind, label, meaning, status, fishing_allowed, updated_by) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (layer_kind) DO UPDATE SET label=EXCLUDED.label, meaning=EXCLUDED.meaning, status=EXCLUDED.status, fishing_allowed=EXCLUDED.fishing_allowed, version=layer_rule.version+1, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [kind, body.label, body.meaning, body.status, body.fishingAllowed, principal(c).personId]);
    await audit(ctx.db, actorOf(principal(c)), 'koederregel_geaendert', 'layer_rule', kind, { vorher: before, nachher: body });
    invalidateBundles();
    return c.json({ ok: true });
  });
  r.delete('/rules/:kind', requirePerm('admin.rules'), async (c) => {
    await q(ctx.db, 'DELETE FROM layer_rule WHERE layer_kind=$1', [c.req.param('kind')]);
    await audit(ctx.db, actorOf(principal(c)), 'koederregel_zurueckgesetzt', 'layer_rule', c.req.param('kind'));
    invalidateBundles();
    return c.json({ ok: true });
  });

  const closureInput = z.object({
    waterKey: z.string().nullable(), sectionIds: z.array(z.string()).default([]), groups: z.array(z.enum(['aktive', 'jugend', 'tageskarte'])).nullable(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(3).max(500), status: z.enum(['active', 'draft', 'revoked']).default('active'),
  }).refine((x) => x.to >= x.from, 'Bis-Datum liegt vor dem Von-Datum').refine((x) => x.waterKey || x.sectionIds.length, 'Gewässer oder Abschnitt angeben');
  r.get('/closures', requirePerm('admin.rules'), async (c) => c.json((await q<any>(ctx.db, 'SELECT * FROM closure ORDER BY date_from DESC')).map((x) => ({ ...closureDto(x), version: x.version, updatedAt: x.updated_at }))));
  r.post('/closures', requirePerm('admin.rules'), async (c) => {
    const b = closureInput.parse(await c.req.json());
    const row = await one<any>(ctx.db, `INSERT INTO closure(water_key, section_ids, map_groups, date_from, date_to, reason, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [b.waterKey, b.sectionIds, b.groups, b.from, b.to, b.reason, b.status, principal(c).personId]);
    await audit(ctx.db, actorOf(principal(c)), 'sperrzeit_erfasst', 'closure', row!.id, b);
    invalidateBundles();
    return c.json({ id: row!.id });
  });
  r.put('/closures/:id', requirePerm('admin.rules'), async (c) => {
    const b = closureInput.parse(await c.req.json());
    await q(ctx.db, `UPDATE closure SET water_key=$2, section_ids=$3, map_groups=$4, date_from=$5, date_to=$6, reason=$7, status=$8, version=version+1, updated_at=now() WHERE id=$1`,
      [c.req.param('id'), b.waterKey, b.sectionIds, b.groups, b.from, b.to, b.reason, b.status]);
    await audit(ctx.db, actorOf(principal(c)), 'sperrzeit_geaendert', 'closure', c.req.param('id'), b);
    invalidateBundles();
    return c.json({ ok: true });
  });

  r.get('/waters', requirePerm('admin.waters'), async (c) => {
    const { result } = await activeAnalysis(ctx, await season());
    const suggestions = await q<any>(ctx.db, `SELECT w.*, p.display_name AS suggested_by_name FROM water w LEFT JOIN person p ON p.id = w.suggested_by WHERE w.source='person' ORDER BY w.created_at DESC`);
    return c.json({ fromMaps: result.waters, suggestions });
  });
  r.post('/waters/:key/decision', requirePerm('admin.waters'), async (c) => {
    const b = z.object({ status: z.enum(['bestaetigt', 'abgelehnt']), name: z.string().trim().min(2).max(120).optional(), note: z.string().max(500).optional() }).parse(await c.req.json());
    await q(ctx.db, `UPDATE water SET status=$2, name=coalesce($3, name), note=coalesce($4, note), decided_by=$5, decided_at=now() WHERE key=$1 AND source='person'`, [c.req.param('key'), b.status, b.name ?? null, b.note ?? null, principal(c).personId]);
    await audit(ctx.db, actorOf(principal(c)), 'gewaesservorschlag_entschieden', 'water', c.req.param('key'), b);
    return c.json({ ok: true });
  });

  r.get('/species', requirePerm('admin.rules'), async (c) => c.json(await q(ctx.db, 'SELECT * FROM fish_species ORDER BY sort, name')));
  r.post('/species', requirePerm('admin.rules'), async (c) => {
    const b = z.object({ name: z.string().trim().min(2).max(60) }).parse(await c.req.json());
    await q(ctx.db, `INSERT INTO fish_species(name, sort) VALUES ($1, (SELECT coalesce(max(sort),0)+1 FROM fish_species))`, [b.name]);
    await audit(ctx.db, actorOf(principal(c)), 'fischart_erfasst', 'fish_species', b.name);
    return c.json({ ok: true });
  });
  r.put('/species/:id', requirePerm('admin.rules'), async (c) => {
    const b = z.object({ active: z.boolean(), sort: z.number().int() }).parse(await c.req.json());
    await q(ctx.db, `UPDATE fish_species SET active=$2, sort=$3, updated_at=now() WHERE id=$1`, [c.req.param('id'), b.active, b.sort]);
    await audit(ctx.db, actorOf(principal(c)), 'fischart_geaendert', 'fish_species', c.req.param('id'), b);
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- Patentarten & Patente (Vorschlag, konfigurierbar)
  const typeInput = z.object({ name: z.string().trim().min(2).max(120), kind: z.enum(['saison', 'tag', 'spezial']), mapGroup: z.enum(['aktive', 'jugend', 'tageskarte']).nullable(),
    status: z.enum(['vorschlag', 'aktiv', 'archiviert']), eventfrogTicketType: z.string().max(200).nullable().optional(), description: z.string().max(2000).nullable().optional() });
  r.get('/permit-types', requirePerm('permits.manage'), async (c) => c.json(await q(ctx.db, 'SELECT * FROM permit_type ORDER BY status, name')));
  r.post('/permit-types', requirePerm('permits.manage'), async (c) => {
    const b = typeInput.parse(await c.req.json());
    const row = await one<any>(ctx.db, `INSERT INTO permit_type(name, kind, map_group, status, eventfrog_ticket_type, description) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [b.name, b.kind, b.mapGroup, b.status, b.eventfrogTicketType ?? null, b.description ?? null]);
    await audit(ctx.db, actorOf(principal(c)), 'patentart_erfasst', 'permit_type', row!.id, b);
    return c.json({ id: row!.id });
  });
  r.put('/permit-types/:id', requirePerm('permits.manage'), async (c) => {
    const b = typeInput.parse(await c.req.json());
    await q(ctx.db, `UPDATE permit_type SET name=$2, kind=$3, map_group=$4, status=$5, eventfrog_ticket_type=$6, description=$7, updated_at=now() WHERE id=$1`, [c.req.param('id'), b.name, b.kind, b.mapGroup, b.status, b.eventfrogTicketType ?? null, b.description ?? null]);
    await audit(ctx.db, actorOf(principal(c)), 'patentart_geaendert', 'permit_type', c.req.param('id'), b);
    invalidateBundles();
    return c.json({ ok: true });
  });
  r.get('/permits', requirePerm('permits.manage'), async (c) => c.json(await q(ctx.db, `SELECT p.*, t.name AS type_name, t.kind AS type_kind, t.is_demo, per.display_name, per.member_no, per.kind AS person_kind
    FROM permit p JOIN permit_type t ON t.id=p.permit_type_id JOIN person per ON per.id=p.person_id ORDER BY p.valid_to DESC LIMIT 1000`)));
  r.post('/permits', requirePerm('permits.manage'), async (c) => {
    const b = z.object({ personId: z.string().uuid(), permitTypeId: z.string().uuid(), validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      paymentStatus: z.string().max(60).default('unbekannt'), note: z.string().max(500).nullable().optional() }).parse(await c.req.json());
    if (b.validTo < b.validFrom) throw new HttpError(400, 'invalid', 'Gültig bis liegt vor gültig ab.');
    const year = Number(b.validFrom.slice(0, 4));
    await q(ctx.db, `INSERT INTO season(year, label) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [year, `Saison ${year}`]);
    const row = await one<any>(ctx.db, `INSERT INTO permit(person_id, permit_type_id, season_year, valid_from, valid_to, status, payment_status, source, credential_code, issued_by, note)
      VALUES ($1,$2,$3,$4,$5,'aktiv',$6,'admin',$7,$8,$9) RETURNING id`, [b.personId, b.permitTypeId, year, b.validFrom, b.validTo, b.paymentStatus, newCredentialCode(), principal(c).personId, b.note ?? null]);
    await audit(ctx.db, actorOf(principal(c)), 'patent_ausgestellt', 'permit', row!.id, b);
    return c.json({ id: row!.id });
  });
  r.put('/permits/:id', requirePerm('permits.manage'), async (c) => {
    const b = z.object({ status: z.enum(['aktiv', 'gesperrt']), validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), paymentStatus: z.string().max(60), note: z.string().max(500).nullable().optional() }).parse(await c.req.json());
    const before = await one<any>(ctx.db, 'SELECT status, valid_to, payment_status FROM permit WHERE id=$1', [c.req.param('id')]);
    await q(ctx.db, `UPDATE permit SET status=$2, valid_to=$3, payment_status=$4, note=$5, updated_at=now() WHERE id=$1`, [c.req.param('id'), b.status, b.validTo, b.paymentStatus, b.note ?? null]);
    await audit(ctx.db, actorOf(principal(c)), b.status === 'gesperrt' ? 'patent_gesperrt' : 'patent_geaendert', 'permit', c.req.param('id'), { vorher: before, nachher: b });
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- Personen & Rollen
  r.get('/persons', requirePerm('admin.members'), async (c) => {
    const rows = await q<any>(ctx.db, `SELECT id, kind, email, display_name, member_no, fairgate_status, fairgate_groups, eligible, roles, extra_permissions, revoked_permissions, source, last_sync_at, anonymized_at, auth_user_id IS NOT NULL AS has_login
      FROM person ORDER BY kind, display_name LIMIT 2000`);
    const out = [];
    for (const p of rows) out.push({ ...p, effectiveRoles: await rolesOf(ctx.db, p) });
    return c.json({ persons: out, permissions: ALL_PERMISSIONS, roleSource: await getSetting(ctx.db, 'roles.source') });
  });
  r.put('/persons/:id/roles', requirePerm('admin.roles'), async (c) => {
    const b = z.object({ roles: z.array(z.enum(['warden', 'admin'])), extraPermissions: z.array(z.string()).default([]), revokedPermissions: z.array(z.string()).default([]) }).parse(await c.req.json());
    const bad = [...b.extraPermissions, ...b.revokedPermissions].filter((x) => !ALL_PERMISSIONS.includes(x as Permission));
    if (bad.length) throw new HttpError(400, 'invalid', `Unbekannte Rechte: ${bad.join(', ')}`);
    const p = principal(c);
    if (c.req.param('id') === p.personId && !b.roles.includes('admin')) throw new HttpError(400, 'self', 'Sie können sich die Admin-Rolle nicht selbst entziehen.');
    const before = await one<any>(ctx.db, 'SELECT roles, extra_permissions, revoked_permissions, auth_user_id FROM person WHERE id=$1', [c.req.param('id')]);
    if (!before) throw new HttpError(404, 'not_found', 'Person nicht gefunden');
    await q(ctx.db, `UPDATE person SET roles=$2, extra_permissions=$3, revoked_permissions=$4, updated_at=now() WHERE id=$1`, [c.req.param('id'), b.roles, b.extraPermissions, b.revokedPermissions]);
    await audit(ctx.db, actorOf(p), 'berechtigung_geaendert', 'person', c.req.param('id'), { vorher: { roles: before.roles, extra: before.extra_permissions, entzogen: before.revoked_permissions }, nachher: b });
    return c.json({ ok: true, note: (await getSetting(ctx.db, 'roles.source')) === 'fairgate' ? 'Hinweis: Rollenquelle ist Fairgate – App-Rollen sind derzeit nicht wirksam.' : undefined });
  });
  r.post('/persons/:id/access-code', requirePerm('admin.members'), async (c) => c.json(await createAccessCode(ctx, c.req.param('id'), actorOf(principal(c)))));
  r.post('/persons/:id/anonymize', requirePerm('admin.members'), async (c) => {
    const b = z.object({ reason: z.string().trim().min(3).max(300) }).parse(await c.req.json());
    await anonymizePerson(ctx, c.req.param('id'), actorOf(principal(c)), b.reason);
    return c.json({ ok: true });
  });
  r.post('/persons/:id/revoke-sessions', requirePerm('admin.members'), async (c) => {
    const p = await one<any>(ctx.db, 'SELECT auth_user_id FROM person WHERE id=$1', [c.req.param('id')]);
    const n = await revokeSessions(ctx.db, p?.auth_user_id ?? null);
    await audit(ctx.db, actorOf(principal(c)), 'sitzungen_entzogen', 'person', c.req.param('id'), { anzahl: n });
    return c.json({ revoked: n });
  });

  // ---------------------------------------------------------------- Integrationen
  r.get('/integrations', async (c) => {
    const status = await q<any>(ctx.db, 'SELECT * FROM integration_status ORDER BY key');
    const logs = await q<any>(ctx.db, 'SELECT * FROM integration_log ORDER BY at DESC LIMIT 200');
    return c.json({ status: status.map((s) => ({ ...s, label: INTEGRATION_LABELS[s.key as keyof typeof INTEGRATION_LABELS] })), logs });
  });
  r.post('/integrations/:key/run', requirePerm('admin.settings'), async (c) => {
    const actor = actorOf(principal(c));
    const key = c.req.param('key');
    let res: unknown;
    if (key === 'fairgate') res = await syncMembers(ctx, actor);
    else if (key === 'eventfrog') res = await syncGuestOrders(ctx, actor);
    else if (key === 'website') res = await syncEvents(ctx, actor);
    else if (key === 'mymaps') res = await checkNetworkLinks(ctx, actor);
    else if (key === 'mail') res = { retried: await ctx.mail.retryPending() };
    else if (key === 'status') { await refreshIntegrationStatus(ctx); res = { ok: true }; }
    else throw new HttpError(404, 'not_found', 'Unbekannte Integration');
    await audit(ctx.db, actor, 'integration_ausgefuehrt', 'integration', key, res);
    return c.json(res);
  });
  r.get('/outbox/mail', async (c) => c.json(await q(ctx.db, 'SELECT * FROM mail_outbox ORDER BY created_at DESC LIMIT 200')));
  r.get('/outbox/push', async (c) => c.json(await q(ctx.db, 'SELECT * FROM push_outbox ORDER BY created_at DESC LIMIT 200')));

  // ---------------------------------------------------------------- Einstellungen & offene Entscheide
  r.get('/settings', requirePerm('admin.settings'), async (c) => c.json(await getAllSettings(ctx.db)));
  r.put('/settings/:key', requirePerm('admin.settings'), async (c) => {
    const key = c.req.param('key');
    const { value } = z.object({ value: z.unknown() }).parse(await c.req.json());
    const err = validateSetting(key, value);
    if (err) throw new HttpError(400, 'invalid', err);
    const before = await getSetting(ctx.db, key);
    const version = await setSetting(ctx.db, key, value, principal(c).personId);
    await audit(ctx.db, actorOf(principal(c)), 'einstellung_geaendert', 'setting', key, { vorher: before, nachher: value, version });
    invalidateBundles();
    return c.json({ ok: true, version });
  });
  r.get('/settings/history', requirePerm('admin.settings'), async (c) => c.json(await q(ctx.db, `SELECT h.*, p.display_name FROM app_setting_history h LEFT JOIN person p ON p.id=h.changed_by ORDER BY changed_at DESC LIMIT 200`)));
  r.get('/decisions', async (c) => c.json(await q(ctx.db, 'SELECT * FROM open_decision ORDER BY length(id), id')));
  r.put('/decisions/:id', requirePerm('admin.settings'), async (c) => {
    const b = z.object({ status: z.enum(['offen', 'entschieden']), decision: z.string().max(4000).nullable(), decidedAt: z.string().nullable() }).parse(await c.req.json());
    await q(ctx.db, `UPDATE open_decision SET status=$2, decision=$3, decided_at=$4, updated_by=$5, updated_at=now() WHERE id=$1`, [c.req.param('id'), b.status, b.decision, b.decidedAt, principal(c).personId]);
    await audit(ctx.db, actorOf(principal(c)), 'entscheid_erfasst', 'open_decision', c.req.param('id'), b);
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- News & Termine
  r.get('/news', requirePerm('news.write'), async (c) => c.json((await q<any>(ctx.db, 'SELECT * FROM news WHERE deleted_at IS NULL ORDER BY published_at DESC LIMIT 300')).map((n) => newsDto(n, ctx.now()))));
  r.post('/news', requirePerm('news.write'), async (c) => c.json(await saveNews(ctx, actorOf(principal(c)), newsInput.parse(await c.req.json()))));
  r.put('/news/:id', requirePerm('news.write'), async (c) => c.json(await saveNews(ctx, actorOf(principal(c)), newsInput.parse(await c.req.json()), c.req.param('id'))));
  r.delete('/news/:id', requirePerm('news.write'), async (c) => { await deleteNews(ctx, actorOf(principal(c)), c.req.param('id')); return c.json({ ok: true }); });
  r.get('/events', async (c) => c.json(await q(ctx.db, 'SELECT e.*, (SELECT count(*) FROM event_registration r WHERE r.event_id=e.id) AS registrations FROM event e ORDER BY starts_at DESC LIMIT 200')));

  // ---------------------------------------------------------------- Kontrollen, Meldungen, Rücklauf
  r.get('/controls', requirePerm('controls.read_all'), async (c) => {
    const controls = await q<any>(ctx.db, `SELECT c.*, w.display_name AS warden_name, per.display_name AS checked_person_name FROM control c JOIN person w ON w.id=c.warden_person_id LEFT JOIN person per ON per.id=c.checked_person_id ORDER BY c.started_at DESC LIMIT 500`);
    const violations = await q<any>(ctx.db, `SELECT v.*, w.display_name AS warden_name FROM violation v JOIN person w ON w.id=v.warden_person_id ORDER BY v.created_at DESC LIMIT 500`);
    await audit(ctx.db, actorOf(principal(c)), 'kontrollen_eingesehen', 'control', null, { anzahl: controls.length });
    return c.json({ controls, violations });
  });
  r.get('/reports', async (c) => c.json(await q(ctx.db, `SELECT r.*, p.display_name, m.status AS mail_status, m.to_addr FROM incident_report r JOIN person p ON p.id=r.person_id LEFT JOIN mail_outbox m ON m.id=r.mail_id ORDER BY r.created_at DESC LIMIT 500`)));
  r.get('/returns', requirePerm('stats.read_all'), async (c) => c.json(await returnRates(ctx, Number(c.req.query('season') ?? (await season())))));
  r.get('/seasons', async (c) => c.json(await q(ctx.db, 'SELECT * FROM season ORDER BY year DESC')));
  r.put('/seasons/:year', requirePerm('admin.settings'), async (c) => {
    const b = z.object({ startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), label: z.string().min(2) }).parse(await c.req.json());
    await q(ctx.db, `INSERT INTO season(year, label, starts_on, ends_on) VALUES ($1,$2,$3,$4) ON CONFLICT (year) DO UPDATE SET label=EXCLUDED.label, starts_on=EXCLUDED.starts_on, ends_on=EXCLUDED.ends_on`, [Number(c.req.param('year')), b.label, b.startsOn, b.endsOn]);
    await audit(ctx.db, actorOf(principal(c)), 'saison_geaendert', 'season', c.req.param('year'), b);
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- Konflikte, Löschanträge, Aufbewahrung, Protokoll
  r.get('/conflicts', async (c) => c.json(await q(ctx.db, `SELECT s.*, p.display_name FROM sync_conflict s JOIN person p ON p.id=s.person_id ORDER BY s.created_at DESC LIMIT 200`)));
  r.post('/conflicts/:id/resolve', requirePerm('admin.settings'), async (c) => {
    const b = z.object({ use: z.enum(['client', 'server']) }).parse(await c.req.json());
    const actor = actorOf(principal(c));
    await tx(ctx.db, async (t) => {
      const k = await one<any>(t, 'SELECT * FROM sync_conflict WHERE id=$1 AND resolved_at IS NULL FOR UPDATE', [c.req.param('id')]);
      if (!k) throw new HttpError(404, 'not_found', 'Konflikt nicht gefunden oder bereits gelöst.');
      if (b.use === 'client' && k.entity === 'catch') {
        const d = k.client_data;
        await q(t, `UPDATE catch SET species=$2, length_cm=$3, disposition=$4, caught_at=$5, version=version+1, updated_at=now() WHERE id=$1`, [k.entity_id, d.species, d.lengthCm, d.disposition, d.caughtAt]);
      } else if (b.use === 'client' && k.entity === 'tour') {
        const d = k.client_data;
        await q(t, `UPDATE tour SET water_key=$2, water_name=$3, started_at=$4, ended_at=$5, pauses=$6, outcome=$7, status=$8, version=version+1, updated_at=now() WHERE id=$1`, [k.entity_id, d.waterKey, d.waterName, d.startedAt, d.endedAt, JSON.stringify(d.pauses ?? []), d.outcome, d.status]);
      }
      await q(t, `INSERT INTO record_revision(entity, entity_id, version, op, actor_person_id, source, reason, data) SELECT $1,$2,(SELECT version FROM ${k.entity === 'catch' ? 'catch' : 'tour'} WHERE id=$2),'conflict_resolution',$3,'admin',$4,$5`,
        [k.entity, k.entity_id, actor.personId, `Konflikt gelöst: ${b.use === 'client' ? 'Gerätestand' : 'Serverstand'} übernommen`, JSON.stringify(b.use === 'client' ? k.client_data : k.server_data)]);
      await q(t, `UPDATE sync_conflict SET resolved_at=now(), resolution=$2, resolved_by=$3 WHERE id=$1`, [k.id, b.use === 'client' ? 'geraet_uebernommen' : 'server_beibehalten', actor.personId]);
      await audit(t, actor, 'konflikt_geloest', 'sync_conflict', k.id, b);
    });
    return c.json({ ok: true });
  });
  r.get('/revisions/:entity/:id', async (c) => c.json(await q(ctx.db, `SELECT r.*, p.display_name FROM record_revision r LEFT JOIN person p ON p.id=r.actor_person_id WHERE entity=$1 AND entity_id=$2 ORDER BY id`, [c.req.param('entity'), c.req.param('id')])));
  r.get('/deletion-requests', requirePerm('admin.members'), async (c) => c.json(await q(ctx.db, `SELECT d.*, p.display_name, p.kind FROM deletion_request d JOIN person p ON p.id=d.person_id ORDER BY d.requested_at DESC`)));
  r.post('/deletion-requests/:id/process', requirePerm('admin.members'), async (c) => {
    const b = z.object({ action: z.enum(['anonymize', 'reject']), note: z.string().trim().min(3).max(1000) }).parse(await c.req.json());
    const d = await one<any>(ctx.db, `SELECT * FROM deletion_request WHERE id=$1 AND status='offen'`, [c.req.param('id')]);
    if (!d) throw new HttpError(404, 'not_found', 'Antrag nicht gefunden.');
    if (b.action === 'anonymize') await anonymizePerson(ctx, d.person_id, actorOf(principal(c)), `Löschantrag: ${b.note}`);
    await q(ctx.db, `UPDATE deletion_request SET status=$2, processed_by=$3, processed_at=now(), note=$4 WHERE id=$1`, [d.id, b.action === 'anonymize' ? 'erledigt' : 'abgelehnt', principal(c).personId, b.note]);
    await audit(ctx.db, actorOf(principal(c)), 'loeschantrag_bearbeitet', 'deletion_request', d.id, b);
    return c.json({ ok: true });
  });
  r.post('/retention/run', requirePerm('admin.settings'), async (c) => {
    const b = z.object({ dryRun: z.boolean().default(true) }).parse(await c.req.json());
    return c.json(await applyRetention(ctx, actorOf(principal(c)), b.dryRun));
  });
  r.get('/audit', requirePerm('admin.audit'), async (c) => c.json(await q(ctx.db, 'SELECT * FROM audit_log ORDER BY at DESC LIMIT $1', [Math.min(1000, Number(c.req.query('limit') ?? 300))])));
  return r;
}
