import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { q } from '../src/db';
import { syncMembers } from '../src/services/accounts';
import { DEMO_CONTACTS } from '../src/integrations/fairgate';
import { api, login, setup, uuid, type T } from './helpers';

let t: T;
const tok: Record<string, string> = {};
beforeAll(async () => {
  t = await setup();
  for (const who of ['mitglied', 'jugend', 'aufseher', 'vorstand', 'gast']) tok[who] = await login(t, `${who}@demo.fvw.invalid`);
}, 120_000);
afterAll(async () => { await t?.ctx.db.end(); });

const now = () => new Date().toISOString();
function tourOps(tourId: string, opts: { closed?: boolean; outcome?: 'catch' | 'null_report' } = {}) {
  const started = new Date(Date.now() - 3600_000).toISOString();
  return {
    started,
    create: { opId: uuid(), entity: 'tour', entityId: tourId, op: 'upsert', baseVersion: null, clientTime: now(),
      data: { waterKey: 'werdenberger-binnenkanal', waterName: 'Werdenberger Binnenkanal', mapGroup: 'aktive', startedAt: started, endedAt: null, pauses: [], outcome: null, status: 'running' } },
    close: (prevOpId: string) => ({ opId: uuid(), entity: 'tour', entityId: tourId, op: 'upsert', baseVersion: null, prevOpId, clientTime: now(),
      data: { waterKey: 'werdenberger-binnenkanal', waterName: 'Werdenberger Binnenkanal', mapGroup: 'aktive', startedAt: started, endedAt: now(), pauses: [], outcome: opts.outcome ?? 'catch', status: 'closed' } }),
  };
}
const catchOp = (tourId: string, data: Record<string, unknown> = {}) => ({ opId: uuid(), entity: 'catch', entityId: uuid(), op: 'upsert', baseVersion: null, clientTime: now(),
  data: { tourId, species: 'Bachforelle', lengthCm: 31, disposition: 'zurueckgesetzt', caughtAt: new Date(Date.now() - 1800_000).toISOString(), ...data } });

describe('Anmeldung und Zugriff', () => {
  it('lehnt nicht berechtigte E-Mails ab, ohne die Mitgliedschaft zu verraten', async () => {
    const r = await api(t, null, '/api/auth/request-code', { body: { email: 'ausgetreten@demo.fvw.invalid' } });
    expect(r.status).toBe(200);
    const mails = await api(t, null, '/api/demo/mailbox?email=ausgetreten@demo.fvw.invalid');
    expect(mails.data).toHaveLength(0);
  });
  it('ohne Sitzung kein Zugriff', async () => {
    expect((await api(t, null, '/api/app/bootstrap')).status).toBe(401);
    expect((await api(t, 'falsch', '/api/app/bootstrap')).status).toBe(401);
  });
  it('Gast mit gültiger Tageskarte sieht nur die Tageskarten-Karte und einen signierten Ausweis', async () => {
    const b = await api(t, tok.gast, '/api/app/bootstrap');
    expect(b.status).toBe(200);
    expect(b.data.me.kind).toBe('guest');
    expect(b.data.mapAccess.groups).toEqual(['tageskarte']);
    expect(b.data.permits.some((p: any) => p.currentlyValid && p.credentialToken.startsWith('FVW1.'))).toBe(true);
    expect(t.ctx.signer.verify(b.data.permits[0].credentialToken)?.n).toBe('Demo Gast');
    expect((await api(t, tok.gast, '/api/app/maps/aktive')).status).toBe(403);
    expect((await api(t, tok.gast, '/api/app/maps/tageskarte')).status).toBe(200);
  });
  it('Gast mit abgelaufener Tageskarte erhält keinen Code', async () => {
    await api(t, null, '/api/auth/request-code', { body: { email: 'gast-abgelaufen@demo.fvw.invalid' } });
    expect((await api(t, null, '/api/demo/mailbox?email=gast-abgelaufen@demo.fvw.invalid')).data).toHaveLength(0);
  });
  it('Mitglied mit zwei Patenten kann zwischen zwei Karten wechseln', async () => {
    const b = await api(t, tok.mitglied, '/api/app/bootstrap');
    expect(b.data.mapAccess.groups.sort()).toEqual(['aktive', 'jugend']);
  });
  it('Kartenpaket mit ETag (304 bei unverändertem Stand)', async () => {
    const r = await api(t, tok.mitglied, '/api/app/maps/aktive');
    expect(r.data.sections).toHaveLength(355);
    const etag = r.headers.get('etag')!;
    expect((await api(t, tok.mitglied, '/api/app/maps/aktive', { headers: { 'If-None-Match': etag } })).status).toBe(304);
  });
  it('Mitglied hat keinen Zugriff auf den Adminbereich', async () => {
    expect((await api(t, tok.mitglied, '/api/admin/overview')).status).toBe(403);
    expect((await api(t, tok.aufseher, '/api/admin/overview')).status).toBe(403);
    expect((await api(t, tok.vorstand, '/api/admin/overview')).status).toBe(200);
  });
});

describe('Fangbuch-Synchronisation', () => {
  it('überträgt Tour + Fänge idempotent (Wiederholung ohne Duplikate)', async () => {
    const tourId = uuid();
    const ops = tourOps(tourId);
    const c1 = catchOp(tourId);
    const c2 = catchOp(tourId, { species: 'Äsche', lengthCm: 36, disposition: 'entnommen' });
    const close = ops.close(ops.create.opId);
    const batch = { deviceId: 'geraet-1', ops: [ops.create, c1, c2, close] };
    const r1 = await api(t, tok.mitglied, '/api/app/sync/push', { body: batch });
    expect(r1.data.results.map((r: any) => r.status)).toEqual(['applied', 'applied', 'applied', 'applied']);
    const r2 = await api(t, tok.mitglied, '/api/app/sync/push', { body: batch });
    expect(r2.data.results.map((r: any) => r.status)).toEqual(['duplicate', 'duplicate', 'duplicate', 'duplicate']);
    const rows = await q(t.ctx.db, 'SELECT count(*)::int AS n FROM catch WHERE tour_id=$1', [tourId]);
    expect(rows[0].n).toBe(2);
    const conflicts = await q(t.ctx.db, 'SELECT count(*)::int AS n FROM sync_conflict WHERE entity_id=$1', [tourId]);
    expect(conflicts[0].n).toBe(0);
  });
  it('akzeptiert offline erfasste Fänge, auch wenn die Tour schon abgeschlossen übertragen wurde', async () => {
    const tourId = uuid();
    const ops = tourOps(tourId);
    const closed = { ...ops.create, data: { ...(ops.create.data as any), endedAt: now(), outcome: 'catch', status: 'closed' } };
    const c = catchOp(tourId);
    const r = await api(t, tok.mitglied, '/api/app/sync/push', { body: { deviceId: 'g', ops: [closed, c] } });
    expect(r.data.results.map((x: any) => x.status)).toEqual(['applied', 'applied']);
  });
  it('lehnt Fänge ohne laufende Tour bzw. mit ungültiger Länge ab – ohne erfundenes Mindestmass', async () => {
    const tourId = uuid();
    const ops = tourOps(tourId);
    await api(t, tok.mitglied, '/api/app/sync/push', { body: { deviceId: 'g', ops: [ops.create] } });
    const r = await api(t, tok.mitglied, '/api/app/sync/push', { body: { deviceId: 'g', ops: [catchOp(tourId, { lengthCm: 0 }), catchOp(tourId, { lengthCm: 151 }), catchOp(tourId, { lengthCm: 2 }), catchOp(uuid())] } });
    expect(r.data.results.map((x: any) => x.status)).toEqual(['rejected', 'rejected', 'applied', 'rejected']);
  });
  it('Nullmeldung schliesst die Tour ab und zählt als Rückmeldung', async () => {
    const tourId = uuid();
    const ops = tourOps(tourId, { outcome: 'null_report' });
    const r = await api(t, tok.gast, '/api/app/sync/push', { body: { deviceId: 'g', ops: [ops.create, ops.close(ops.create.opId)] } });
    expect(r.data.results.every((x: any) => x.status === 'applied')).toBe(true);
    const b = await api(t, tok.gast, '/api/app/bootstrap');
    const today = new Date().toISOString().slice(0, 10);
    // heutige Tageskarte gemeldet; die ältere Demo-Tageskarte (vor 20 Tagen) bleibt «Fangmeldung offen»
    expect(b.data.openReports.some((o: any) => o.validFrom === today)).toBe(false);
    expect(b.data.openReports).toHaveLength(1);
  });
  it('Änderung nach Abschluss braucht einen Grund und wird protokolliert', async () => {
    const tourId = uuid();
    const ops = tourOps(tourId);
    const c = catchOp(tourId);
    const close = ops.close(ops.create.opId);
    await api(t, tok.mitglied, '/api/app/sync/push', { body: { deviceId: 'g', ops: [ops.create, c, close] } });
    const edit = { ...c, opId: uuid(), baseVersion: 1, data: { ...(c.data as any), lengthCm: 33 } };
    expect((await api(t, tok.mitglied, '/api/app/sync/push', { body: { deviceId: 'g', ops: [edit] } })).data.results[0].status).toBe('rejected');
    const edit2 = { ...edit, opId: uuid(), data: { ...(edit.data as any), changeReason: 'Länge falsch abgelesen' } };
    expect((await api(t, tok.mitglied, '/api/app/sync/push', { body: { deviceId: 'g', ops: [edit2] } })).data.results[0].status).toBe('applied');
    const rev = await api(t, tok.vorstand, `/api/admin/revisions/catch/${c.entityId}`);
    expect(rev.data.map((x: any) => x.reason)).toContain('Länge falsch abgelesen');
  });
  it('Konflikt: Admin-Änderung wird nicht stillschweigend überschrieben, Geräteversion bleibt erhalten', async () => {
    const tourId = uuid();
    const ops = tourOps(tourId);
    const c = catchOp(tourId);
    await api(t, tok.mitglied, '/api/app/sync/push', { body: { deviceId: 'g', ops: [ops.create, c] } });
    await q(t.ctx.db, `UPDATE catch SET length_cm=40, version=2 WHERE id=$1`, [c.entityId]);
    await q(t.ctx.db, `INSERT INTO record_revision(entity, entity_id, version, op, source, data) VALUES ('catch',$1,2,'update','admin','{}')`, [c.entityId]);
    const edit = { ...c, opId: uuid(), baseVersion: 1, data: { ...(c.data as any), lengthCm: 35 } };
    const r = await api(t, tok.mitglied, '/api/app/sync/push', { body: { deviceId: 'g', ops: [edit] } });
    expect(r.data.results[0].status).toBe('conflict');
    const k = await q<any>(t.ctx.db, 'SELECT client_data FROM sync_conflict WHERE entity_id=$1 AND resolved_at IS NULL', [c.entityId]);
    expect(k[0].client_data.lengthCm).toBe(35);
    const pull = await api(t, tok.mitglied, '/api/app/sync/pull');
    expect(pull.data.conflicts.length).toBeGreaterThan(0);
  });
  it('fremde Datensätze können nicht überschrieben werden', async () => {
    const tourId = uuid();
    const ops = tourOps(tourId);
    await api(t, tok.mitglied, '/api/app/sync/push', { body: { deviceId: 'g', ops: [ops.create] } });
    const hijack = { ...ops.create, opId: uuid(), baseVersion: 1, data: { ...(ops.create.data as any), waterName: 'Manipuliert' } };
    const r = await api(t, tok.jugend, '/api/app/sync/push', { body: { deviceId: 'x', ops: [hijack, catchOp(tourId)] } });
    expect(r.data.results.map((x: any) => x.status)).toEqual(['rejected', 'rejected']);
    const replay = await api(t, tok.jugend, '/api/app/sync/push', { body: { deviceId: 'x', ops: [ops.create] } });
    expect(replay.data.results[0].status).toBe('rejected');
  });
});

describe('Fangliste, CSV und Berechtigungen', () => {
  it('Mitglied sieht nur eigene Fänge; «alle» nur für Admin', async () => {
    const jt = uuid();
    const jops = tourOps(jt);
    await api(t, tok.jugend, '/api/app/sync/push', { body: { deviceId: 'j', ops: [jops.create, catchOp(jt, { species: 'Groppe', lengthCm: 9 })] } });
    const mine = await api(t, tok.jugend, '/api/app/catches');
    expect(mine.status).toBe(200);
    expect(mine.data.every((c: any) => c.member.startsWith('Demo Jugendfischer'))).toBe(true);
    expect((await api(t, tok.mitglied, '/api/app/catches?scope=all')).status).toBe(403);
    expect((await api(t, tok.aufseher, '/api/app/catches?scope=all')).status).toBe(403);
    const all = await api(t, tok.vorstand, '/api/app/catches?scope=all');
    expect(all.status).toBe(200);
    expect(new Set(all.data.map((c: any) => c.member)).size).toBeGreaterThan(1);
    const filtered = await api(t, tok.vorstand, '/api/app/catches?scope=all&species=%C3%84sche');
    expect(filtered.data.every((c: any) => c.species === 'Äsche')).toBe(true);
  });
  it('CSV enthält die geforderten Spalten mit Umlauten', async () => {
    const r = await api(t, tok.mitglied, '/api/app/catches.csv');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/csv');
    const lines = (r.data as string).replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toBe('Datum;Uhrzeit;Mitglied;Gewässer;Art;Länge;Entnommen');
    expect(lines.some((l) => l.includes(';Äsche;36;ja'))).toBe(true);
    expect((await api(t, tok.mitglied, '/api/app/catches.csv?scope=all')).status).toBe(403);
  });
  it('Aufseher-Kontrolle offline erfasst, synchronisiert und nur restriktiv sichtbar', async () => {
    const guestBoot = await api(t, tok.gast, '/api/app/bootstrap');
    const code = guestBoot.data.permits[0].credentialCode;
    const controlId = uuid();
    const op = { opId: uuid(), entity: 'control', entityId: controlId, op: 'upsert', baseVersion: null, clientTime: now(), data: {
      startedAt: now(), endedAt: now(), waterKey: 'werdenberger-binnenkanal', waterName: 'Werdenberger Binnenkanal', checkedCredentialCode: code, credentialResult: 'gueltig',
      checkedPersonLabel: 'Demo Gast', tourId: null, notes: 'Demo-Kontrolle', photoIds: [], confirmation: null, status: 'abgeschlossen' } };
    const v = { opId: uuid(), entity: 'violation', entityId: uuid(), op: 'upsert', baseVersion: null, clientTime: now(), data: { controlId, firstName: null, lastName: null, description: 'Demo-Beschreibung', photoIds: [] } };
    const r = await api(t, tok.aufseher, '/api/app/sync/push', { body: { deviceId: 'a', ops: [op, v] } });
    expect(r.data.results.map((x: any) => x.status)).toEqual(['applied', 'applied']);
    expect((await api(t, tok.mitglied, '/api/app/sync/push', { body: { deviceId: 'm', ops: [{ ...op, opId: uuid(), entityId: uuid() }] } })).data.results[0].status).toBe('rejected');
    expect((await api(t, tok.aufseher, '/api/admin/controls')).status).toBe(403);
    const adm = await api(t, tok.vorstand, '/api/admin/controls');
    expect(adm.data.controls[0].permit_id).toBeTruthy();
    const edit = { ...op, opId: uuid(), baseVersion: 1, data: { ...op.data, notes: 'nachträglich geändert' } };
    expect((await api(t, tok.aufseher, '/api/app/sync/push', { body: { deviceId: 'a', ops: [edit] } })).data.results[0].status).toBe('rejected');
  });
  it('Vergehensmeldung: konfigurierte Pflichtfelder werden geprüft', async () => {
    await api(t, tok.vorstand, '/api/admin/settings/control.violation_required_fields', { method: 'PUT', body: { value: ['firstName', 'lastName', 'description'] } });
    const v = { opId: uuid(), entity: 'violation', entityId: uuid(), op: 'upsert', baseVersion: null, clientTime: now(), data: { controlId: null, firstName: '', lastName: null, description: 'x', photoIds: [] } };
    expect((await api(t, tok.aufseher, '/api/app/sync/push', { body: { deviceId: 'a', ops: [v] } })).data.results[0].status).toBe('rejected');
    await api(t, tok.vorstand, '/api/admin/settings/control.violation_required_fields', { method: 'PUT', body: { value: ['description'] } });
  });
});

describe('Meldungen, News, Termine', () => {
  it('Meldung Verschmutzung: offline erzeugt, idempotent, Versand nur als Entwurf an konfigurierte Adresse', async () => {
    const id = uuid();
    const op = { opId: uuid(), entity: 'incident_report', entityId: id, op: 'upsert', baseVersion: null, clientTime: now(), data: { kind: 'verschmutzung', description: 'Ölfilm auf dem Wasser (Test)', waterKey: null, waterName: 'Werdenberger Binnenkanal', location: null, photoIds: [], observedAt: now() } };
    const r = await api(t, tok.mitglied, '/api/app/sync/push', { body: { deviceId: 'g', ops: [op] } });
    expect(r.data.results[0].status).toBe('applied');
    const again = await api(t, tok.mitglied, '/api/app/sync/push', { body: { deviceId: 'g', ops: [{ ...op, opId: uuid() }] } });
    expect(again.data.results[0].status).toBe('duplicate');
    const mails = await q<any>(t.ctx.db, `SELECT * FROM mail_outbox WHERE kind='meldung'`);
    expect(mails).toHaveLength(1);
    expect(mails[0].status).toBe('entwurf');
    expect(mails[0].to_addr).toBe('harald.goeldi@gmail.com');
    const pull = await api(t, tok.mitglied, '/api/app/sync/pull');
    expect(pull.data.reports.find((x: any) => x.id === id).deliveryStatus).toBe('entwurf');
  });
  it('News: Gewässerzustand erfassen, Sichtbarkeit, abgelaufene Meldungen gekennzeichnet', async () => {
    expect((await api(t, tok.mitglied, '/api/app/news', { body: { title: 'x', body: 'y' } })).status).toBe(403);
    const r = await api(t, tok.vorstand, '/api/admin/news', { body: { title: 'Test: Trübung', body: 'Nach Gewitter trüb.', category: 'gewaesserzustand', waterKey: 'voralpsee', waterName: 'Voralpsee', condition: { turbidity: 'trüb' }, visibility: 'mitglieder', expiresAt: new Date(Date.now() + 86400_000).toISOString() } });
    expect(r.status).toBe(200);
    const memberNews = await api(t, tok.mitglied, '/api/app/news');
    expect(memberNews.data.some((n: any) => n.title === 'Test: Trübung')).toBe(true);
    expect(memberNews.data.find((n: any) => n.title === 'Demo: Abgelaufene Meldung').expired).toBe(true);
    const guestNews = await api(t, tok.gast, '/api/app/news');
    expect(guestNews.data.some((n: any) => n.visibility === 'mitglieder')).toBe(false);
  });
  it('Termine aus dem (Demo-)Feed, Kalenderdatei, Anmeldung als E-Mail-Entwurf', async () => {
    const ev = await api(t, tok.gast, '/api/app/events');
    expect(ev.data.length).toBe(3);
    const ics = await api(t, tok.gast, `/api/app/events/${ev.data[0].id}/ics`);
    expect(ics.data).toContain('BEGIN:VEVENT');
    const op = { opId: uuid(), entity: 'event_registration', entityId: uuid(), op: 'upsert', baseVersion: null, clientTime: now(), data: { eventId: ev.data[0].id, participants: 2, message: null } };
    expect((await api(t, tok.mitglied, '/api/app/sync/push', { body: { deviceId: 'g', ops: [op] } })).data.results[0].status).toBe('applied');
    const mails = await q<any>(t.ctx.db, `SELECT * FROM mail_outbox WHERE kind='terminanmeldung'`);
    expect(mails[0].status).toBe('entwurf');
    expect(mails[0].to_addr).toBe('harald.goeldi@gmail.com');
  });
});

describe('Karten im Backend', () => {
  it('KMZ mit nur Netzwerklink wird abgelehnt und gekennzeichnet', async () => {
    const { readFileSync } = await import('node:fs');
    const buf = readFileSync(new URL('../../data/source/2026/kmz-netzwerklinks/Tageskarte.kmz'.replace('Tageskarte', 'Gewässerkarte 2026 Tageskarte'), import.meta.url));
    const form = new FormData();
    form.set('group', 'tageskarte');
    form.set('file', new File([buf], 'Gewässerkarte 2026 Tageskarte.kmz'));
    const r = await t.app.request('/api/admin/maps/upload', { method: 'POST', headers: { Authorization: `Bearer ${tok.vorstand}` }, body: form });
    expect(r.status).toBe(422);
    expect((await r.json() as any).error).toBe('network_link_only');
  });
  it('tägliche Prüfung: unveränderte Prüfsumme löst nichts aus; Änderung erzeugt Entwurf; Rückkehr möglich', async () => {
    const r1 = await api(t, tok.vorstand, '/api/admin/maps/check', { body: {} });
    expect(r1.data.map((x: any) => x.result)).toEqual(['unveraendert', 'unveraendert', 'unveraendert']);
    const { readFileSync, writeFileSync } = await import('node:fs');
    const f = `${t.mymapsDir}/1GOP3PF7BT3ops0HwjviU5NQaVWDJgk0.kml`;
    writeFileSync(f, readFileSync(f, 'utf8').replace('<name>Pachtgrenze Nord</name>', '<name>Pachtgrenze Nord (geändert)</name>'));
    const r2 = await api(t, tok.vorstand, '/api/admin/maps/check', { body: {} });
    expect(r2.data.find((x: any) => x.group === 'tageskarte').result).toBe('geaendert');
    const maps = await api(t, tok.vorstand, '/api/admin/maps');
    const draft = maps.data.versions.find((v: any) => v.map_group === 'tageskarte' && v.status === 'entwurf');
    expect(draft).toBeTruthy();
    const report = await api(t, tok.vorstand, `/api/admin/maps/versions/${draft.id}/report`);
    expect(report.data.diffToActive.added.length).toBe(1);
    await api(t, tok.vorstand, `/api/admin/maps/versions/${draft.id}/activate`, { body: {} });
    const rb = await api(t, tok.vorstand, '/api/admin/maps/rollback', { body: { group: 'tageskarte' } });
    expect(rb.status).toBe(200);
    const audit = await api(t, tok.vorstand, '/api/admin/audit');
    expect(audit.data.some((a: any) => a.action === 'kartenversion_zurueckgesetzt')).toBe(true);
  });
  it('Fehler beim Abruf: letzte Version bleibt gültig, Integrationsstatus «Fehler»', async () => {
    const { rmSync } = await import('node:fs');
    rmSync(`${t.mymapsDir}/1gneLQ1JulxHv-ZE7Kz2pTtQEb32D_jM.kml`);
    const r = await api(t, tok.vorstand, '/api/admin/maps/check', { body: {} });
    expect(r.data.find((x: any) => x.group === 'jugend').result).toBe('fehler');
    const ov = await api(t, tok.vorstand, '/api/admin/overview');
    expect(ov.data.integrations.find((i: any) => i.key === 'mymaps').mode).toBe('error');
    expect((await api(t, tok.mitglied, '/api/app/maps/jugend')).data.sections).toHaveLength(110);
  });
  it('Normalisierung nur nach Admin-Bestätigung, mit Protokoll', async () => {
    const issues = await api(t, tok.vorstand, '/api/admin/maps/issues');
    const typo = issues.data.issues.find((i: any) => i.kind === 'rule_text_typo');
    const before = (await api(t, tok.mitglied, '/api/app/maps/aktive')).data.sections.find((s: any) => s.id === typo.sectionIds[0]);
    expect(before.ruleText).toContain('NNatur');
    await api(t, tok.vorstand, `/api/admin/maps/issues/${encodeURIComponent(typo.id)}/decision`, { body: { status: 'bestaetigt' } });
    const after = (await api(t, tok.mitglied, '/api/app/maps/aktive')).data.sections.find((s: any) => s.id === typo.sectionIds[0]);
    expect(after.ruleText.startsWith('Natur')).toBe(true);
    expect(after.ruleTextOriginal).toContain('NNatur');
    const tie = issues.data.issues.find((i: any) => i.kind === 'name_variant_known' && !i.suggestion);
    expect((await api(t, tok.vorstand, `/api/admin/maps/issues/${encodeURIComponent(tie.id)}/decision`, { body: { status: 'bestaetigt' } })).status).toBe(400);
  });
});

describe('Fairgate-Abgleich', () => {
  it('Austritt entzieht den Zugriff beim nächsten Abgleich', async () => {
    const tokenBefore = await login(t, 'jugend@demo.fvw.invalid');
    expect((await api(t, tokenBefore, '/api/app/bootstrap')).status).toBe(200);
    const fg = t.ctx.fairgate as any;
    fg.contacts = DEMO_CONTACTS.filter((c) => c.email !== 'jugend@demo.fvw.invalid').map((c) => ({ ...c }));
    const r = await syncMembers(t.ctx);
    expect(r.ok).toBe(true);
    expect((await api(t, tokenBefore, '/api/app/bootstrap')).status).toBe(401);
    fg.contacts = DEMO_CONTACTS.map((c) => ({ ...c }));
    await syncMembers(t.ctx);
  });
  it('Plan B: Zugangscode vom Vorstand für Mitglied ohne E-Mail', async () => {
    const persons = await api(t, tok.vorstand, '/api/admin/persons');
    const noMail = persons.data.persons.find((p: any) => p.display_name === 'Demo OhneEmail');
    const code = await api(t, tok.vorstand, `/api/admin/persons/${noMail.id}/access-code`, { body: {} });
    const r = await api(t, null, '/api/auth/access-code', { body: { code: code.data.code } });
    expect(r.status).toBe(200);
    expect((await api(t, r.data.token, '/api/app/bootstrap')).data.me.displayName).toBe('Demo OhneEmail');
    expect((await api(t, null, '/api/auth/access-code', { body: { code: code.data.code } })).status).toBe(400);
  });
});

describe('Rücklaufquote', () => {
  it('berechnet Quote pro Patentart und markiert fehlende Meldungen ohne Sanktion', async () => {
    const r = await api(t, tok.vorstand, '/api/admin/returns');
    expect(r.status).toBe(200);
    expect(r.data.note).toContain('O15');
    const day = r.data.byType.find((x: any) => x.kind === 'tag');
    // Demo: Gast mit 2 Tageskarten (heute gemeldet, vor 20 Tagen offen) + abgelaufener Gast (1 Karte, offen)
    expect(day.total).toBe(3);
    expect(day.reported).toBe(1);
    expect(day.missing).toHaveLength(2);
    expect(day.rate).toBeCloseTo(1 / 3);
    expect((await api(t, tok.mitglied, '/api/admin/returns')).status).toBe(403);
  });
});
