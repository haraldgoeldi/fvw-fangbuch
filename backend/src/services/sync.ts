import {
  validateCatch, validateTour, zurichDate, formatDateTimeCH,
  type SyncOp, type SyncOpResult, type ValidationError,
} from '@fvw/shared';
import { z } from 'zod';
import { audit } from '../audit';
import { actorOf, has, HttpError, type Principal } from '../authz';
import type { AppContext } from '../context';
import { one, q, tx, type Tx } from '../db';
import { getSetting } from '../settings';
import { speciesNames } from './catalog';

const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Ungültiges Datum');
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const opSchema = z.object({
  opId: z.string().regex(uuidRe),
  entity: z.enum(['tour', 'catch', 'water_suggestion', 'incident_report', 'control', 'violation', 'event_registration']),
  entityId: z.string().regex(uuidRe),
  op: z.enum(['upsert', 'delete']),
  baseVersion: z.number().int().nullable(),
  prevOpId: z.string().regex(uuidRe).nullable().optional(),
  data: z.record(z.string(), z.unknown()),
  clientTime: iso,
});
export const pushSchema = z.object({ deviceId: z.string().min(1).max(100), ops: z.array(opSchema).max(500) });

class Rejected extends Error {
  constructor(message: string, public errors?: ValidationError[]) { super(message); }
}

interface Handler {
  perm?: Parameters<typeof has>[1];
  apply(ctx: AppContext, c: Tx, p: Principal, op: SyncOp, deviceId: string): Promise<SyncOpResult>;
}

async function revision(c: Tx, entity: string, id: string, version: number, op: string, p: Principal, source: string, data: unknown, reason: string | null = null) {
  await q(c, `INSERT INTO record_revision(entity, entity_id, version, op, actor_person_id, source, reason, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [entity, id, version, op, p.personId, source, reason, JSON.stringify(data)]);
}

async function lastRevisionSource(c: Tx, entity: string, id: string) {
  const r = await one<{ source: string }>(c, 'SELECT source FROM record_revision WHERE entity=$1 AND entity_id=$2 ORDER BY id DESC LIMIT 1', [entity, id]);
  return r?.source ?? 'app';
}

/**
 * Konfliktregel (nachvollziehbar, nichts geht verloren):
 *  - Änderung auf veralteter Version, letzte Serveränderung stammt von derselben Person (App) →
 *    Gerätestand gewinnt; der überschriebene Serverstand bleibt in record_revision + sync_conflict (automatisch gelöst).
 *  - Letzte Serveränderung stammt vom Admin → Gerätestand wird NICHT angewendet; offener Konflikt mit beiden
 *    Ständen, Lösung im Adminbereich bzw. in der App.
 */
async function handleVersionConflict(c: Tx, entity: string, id: string, p: Principal, op: SyncOp, server: any): Promise<'apply' | SyncOpResult> {
  if (op.baseVersion === server.version) return 'apply';
  if (op.prevOpId) {
    const prev = await one<{ result: any; person_id: string }>(c, 'SELECT result, person_id FROM sync_op WHERE op_id = $1', [op.prevOpId]);
    if (prev && prev.person_id === p.personId && prev.result?.version === server.version) return 'apply';
  }
  const src = await lastRevisionSource(c, entity, id);
  const conflict = await one<{ id: string }>(c, `INSERT INTO sync_conflict(entity, entity_id, person_id, base_version, server_version, client_data, server_data, resolved_at, resolution)
    VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $8 THEN now() END, CASE WHEN $8 THEN 'geraet_gewinnt_automatisch' END) RETURNING id`,
    [entity, id, p.personId, op.baseVersion, server.version, JSON.stringify(op.data), JSON.stringify(server), src !== 'admin']);
  if (src !== 'admin') return 'apply';
  return { opId: op.opId, entityId: id, status: 'conflict', version: server.version, conflictId: conflict!.id, message: 'Der Datensatz wurde inzwischen vom Vorstand geändert. Ihre Version ist gespeichert und wird geprüft.' };
}

// ---------------------------------------------------------------- Tour

const tourData = z.object({
  waterKey: z.string().min(1).max(200), waterName: z.string().min(1).max(200), waterUnverified: z.boolean().optional(),
  mapGroup: z.enum(['aktive', 'jugend', 'tageskarte']).nullable().optional(), permitId: z.string().regex(uuidRe).nullable().optional(),
  startedAt: iso, endedAt: iso.nullable(), pauses: z.array(z.object({ start: iso, end: iso.nullable() })).max(50).default([]),
  outcome: z.enum(['catch', 'null_report']).nullable(), status: z.enum(['running', 'closed']),
});

const tourHandler: Handler = {
  perm: 'catches.write_own',
  async apply(_ctx, c, p, op, deviceId) {
    const existing = await one<any>(c, 'SELECT * FROM tour WHERE id = $1 FOR UPDATE', [op.entityId]);
    if (existing && existing.person_id !== p.personId) throw new Rejected('Fremde Tour.');
    if (op.op === 'delete') {
      if (!existing) return { opId: op.opId, entityId: op.entityId, status: 'applied', version: 0 };
      const v = existing.version + 1;
      await q(c, 'UPDATE tour SET deleted_at = now(), version = $2, updated_at = now() WHERE id = $1', [op.entityId, v]);
      await q(c, 'UPDATE catch SET deleted_at = now(), version = version + 1, updated_at = now() WHERE tour_id = $1 AND deleted_at IS NULL', [op.entityId]);
      await revision(c, 'tour', op.entityId, v, 'delete', p, 'app', existing, (op.data.changeReason as string) ?? null);
      return { opId: op.opId, entityId: op.entityId, status: 'applied', version: v };
    }
    const d = tourData.safeParse(op.data);
    if (!d.success) throw new Rejected('Ungültige Tourdaten.', d.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
    const errs = validateTour(d.data);
    if (errs.length) throw new Rejected('Ungültige Tour.', errs);
    if (d.data.permitId) {
      const permit = await one(c, 'SELECT id FROM permit WHERE id = $1 AND person_id = $2', [d.data.permitId, p.personId]);
      if (!permit) d.data.permitId = null;
    }
    const row = [op.entityId, p.personId, d.data.waterKey, d.data.waterName, !!d.data.waterUnverified, d.data.mapGroup ?? null, d.data.permitId ?? null,
      d.data.startedAt, d.data.endedAt, JSON.stringify(d.data.pauses), d.data.outcome, d.data.status, deviceId];
    if (!existing) {
      await q(c, `INSERT INTO tour(id, person_id, water_key, water_name, water_unverified, map_group, permit_id, started_at, ended_at, pauses, outcome, status, device_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, row);
      await revision(c, 'tour', op.entityId, 1, 'create', p, 'app', d.data);
      return { opId: op.opId, entityId: op.entityId, status: 'applied', version: 1 };
    }
    const decision = await handleVersionConflict(c, 'tour', op.entityId, p, op, existing);
    if (decision !== 'apply') return decision;
    const reason = existing.status === 'closed' ? ((op.data.changeReason as string) || null) : null;
    if (existing.status === 'closed' && !reason) throw new Rejected('Änderungen an abgeschlossenen Touren brauchen einen Grund.', [{ field: 'changeReason', message: 'Grund fehlt' }]);
    const v = existing.version + 1;
    await q(c, `UPDATE tour SET water_key=$3, water_name=$4, water_unverified=$5, map_group=$6, permit_id=$7, started_at=$8, ended_at=$9, pauses=$10, outcome=$11, status=$12,
      device_id=$13, version=${v}, updated_at=now(), deleted_at=NULL WHERE id=$1 AND person_id=$2`, row);
    await revision(c, 'tour', op.entityId, v, 'update', p, 'app', d.data, reason);
    return { opId: op.opId, entityId: op.entityId, status: 'applied', version: v };
  },
};

// ---------------------------------------------------------------- Fang

const catchData = z.object({
  tourId: z.string().regex(uuidRe), species: z.string().min(1).max(60), lengthCm: z.number(), disposition: z.enum(['entnommen', 'zurueckgesetzt']),
  caughtAt: iso, changeReason: z.string().max(500).nullable().optional(),
});

const catchHandler: Handler = {
  perm: 'catches.write_own',
  async apply(ctx, c, p, op) {
    const existing = await one<any>(c, 'SELECT * FROM catch WHERE id = $1 FOR UPDATE', [op.entityId]);
    if (existing && existing.person_id !== p.personId) throw new Rejected('Fremder Fang.');
    if (op.op === 'delete') {
      if (!existing) return { opId: op.opId, entityId: op.entityId, status: 'applied', version: 0 };
      const tour = await one<any>(c, 'SELECT status FROM tour WHERE id=$1', [existing.tour_id]);
      const reason = (op.data.changeReason as string) || null;
      if (tour?.status === 'closed' && !reason) throw new Rejected('Löschen in abgeschlossener Tour braucht einen Grund.', [{ field: 'changeReason', message: 'Grund fehlt' }]);
      const v = existing.version + 1;
      await q(c, 'UPDATE catch SET deleted_at = now(), version=$2, updated_at=now() WHERE id=$1', [op.entityId, v]);
      await revision(c, 'catch', op.entityId, v, 'delete', p, 'app', existing, reason);
      return { opId: op.opId, entityId: op.entityId, status: 'applied', version: v };
    }
    const d = catchData.safeParse(op.data);
    if (!d.success) throw new Rejected('Ungültige Fangdaten.', d.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
    const tour = await one<any>(c, 'SELECT * FROM tour WHERE id = $1 AND deleted_at IS NULL', [d.data.tourId]);
    if (!tour || tour.person_id !== p.personId) throw new Rejected('Tour zum Fang nicht gefunden.', [{ field: 'tourId', message: 'Tour fehlt' }]);
    // Fang wurde während der Tour erfasst (offline), Tour aber schon abgeschlossen übertragen → zulässig, wenn Zeitpunkt in der Tour liegt
    const caught = Date.parse(d.data.caughtAt);
    const withinTour = caught >= Date.parse(tour.started_at) - 60_000 && (!tour.ended_at || caught <= Date.parse(tour.ended_at) + 60_000);
    const editingClosed = tour.status === 'closed' && !!existing;
    const tourForValidation = { status: tour.status === 'closed' && !existing && withinTour ? 'running' as const : tour.status, startedAt: tour.started_at, endedAt: tour.ended_at };
    const errs = validateCatch(d.data, tourForValidation, await speciesNames(c, true), { editingClosedTour: editingClosed });
    if (errs.length) throw new Rejected('Ungültiger Fang.', errs);
    if (!existing) {
      await q(c, `INSERT INTO catch(id, tour_id, person_id, species, length_cm, disposition, caught_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [op.entityId, d.data.tourId, p.personId, d.data.species, d.data.lengthCm, d.data.disposition, d.data.caughtAt]);
      await revision(c, 'catch', op.entityId, 1, 'create', p, 'app', d.data);
      return { opId: op.opId, entityId: op.entityId, status: 'applied', version: 1 };
    }
    const decision = await handleVersionConflict(c, 'catch', op.entityId, p, op, existing);
    if (decision !== 'apply') return decision;
    const v = existing.version + 1;
    await q(c, `UPDATE catch SET species=$2, length_cm=$3, disposition=$4, caught_at=$5, version=$6, updated_at=now(), deleted_at=NULL WHERE id=$1`,
      [op.entityId, d.data.species, d.data.lengthCm, d.data.disposition, d.data.caughtAt, v]);
    await revision(c, 'catch', op.entityId, v, 'update', p, 'app', d.data, d.data.changeReason ?? null);
    void ctx;
    return { opId: op.opId, entityId: op.entityId, status: 'applied', version: v };
  },
};

// ---------------------------------------------------------------- Gewässervorschlag

const waterSuggestionHandler: Handler = {
  perm: 'catches.write_own',
  async apply(_ctx, c, p, op) {
    const d = z.object({ name: z.string().trim().min(2).max(120), note: z.string().max(500).nullable().optional(), mapGroup: z.string().nullable().optional(), waterKey: z.string().min(1).max(200) }).safeParse(op.data);
    if (!d.success) throw new Rejected('Ungültiger Gewässervorschlag.');
    await q(c, `INSERT INTO water(key, name, source, status, map_groups, suggested_by, suggestion_id, note) VALUES ($1,$2,'person','ungeprueft',$3,$4,$5,$6)
      ON CONFLICT (key) DO NOTHING`, [d.data.waterKey, d.data.name, d.data.mapGroup ? [d.data.mapGroup] : [], p.personId, op.entityId, d.data.note ?? null]);
    return { opId: op.opId, entityId: op.entityId, status: 'applied', version: 1 };
  },
};

// ---------------------------------------------------------------- Meldung Verschmutzung / tote Fische

const reportHandler: Handler = {
  perm: 'reports.write',
  async apply(ctx, c, p, op) {
    const d = z.object({
      kind: z.enum(['verschmutzung', 'tote_fische', 'andere']), description: z.string().trim().min(3).max(4000),
      waterKey: z.string().nullable().optional(), waterName: z.string().max(200).nullable().optional(),
      location: z.object({ lat: z.number(), lon: z.number(), accuracyM: z.number().nullable() }).nullable().optional(),
      photoIds: z.array(z.string().regex(uuidRe)).max(10).default([]), observedAt: iso,
    }).safeParse(op.data);
    if (!d.success) throw new Rejected('Ungültige Meldung.', d.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
    const exists = await one(c, 'SELECT id FROM incident_report WHERE id=$1', [op.entityId]);
    if (exists) return { opId: op.opId, entityId: op.entityId, status: 'duplicate', version: 1 };
    await q(c, `INSERT INTO incident_report(id, person_id, kind, description, water_key, water_name, location, photo_ids, observed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [op.entityId, p.personId, d.data.kind, d.data.description, d.data.waterKey ?? null, d.data.waterName ?? null, d.data.location ? JSON.stringify(d.data.location) : null, d.data.photoIds, d.data.observedAt]);
    const delivery = await getSetting<string>(c, 'recipients.incident_delivery');
    if (delivery === 'email') {
      const to = await getSetting<string>(c, 'recipients.incident_report');
      const kindLabel = { verschmutzung: 'Verschmutzung', tote_fische: 'Tote Fische', andere: 'Andere Beobachtung' }[d.data.kind];
      const loc = d.data.location ? `\nStandort (mit Einwilligung): https://map.geo.admin.ch/?swisssearch=${d.data.location.lat},${d.data.location.lon} (Genauigkeit ca. ${Math.round(d.data.location.accuracyM ?? 0)} m)` : '\nStandort: nicht übermittelt';
      const mail = await ctx.mail.send({
        kind: 'meldung', to, subject: `Meldung: ${kindLabel}${d.data.waterName ? ` – ${d.data.waterName}` : ''}`,
        body: `Meldung aus der Fangbuch-App\n\nArt: ${kindLabel}\nGewässer: ${d.data.waterName ?? 'nicht angegeben'}\nBeobachtet: ${formatDateTimeCH(d.data.observedAt)}\nGemeldet von: ${p.displayName}${p.memberNo ? ` (${p.memberNo})` : ''}${loc}\nFotos: ${d.data.photoIds.length} (im Adminbereich einsehbar)\n\nBeschreibung:\n${d.data.description}`,
        related: { incidentId: op.entityId },
      });
      await q(c, 'UPDATE incident_report SET mail_id=$2 WHERE id=$1', [op.entityId, mail.id]);
    }
    return { opId: op.opId, entityId: op.entityId, status: 'applied', version: 1 };
  },
};

// ---------------------------------------------------------------- Kontrolle & Vergehen (Aufseher)

const controlHandler: Handler = {
  perm: 'controls.write',
  async apply(ctx, c, p, op) {
    const d = z.object({
      startedAt: iso, endedAt: iso.nullable(), waterKey: z.string().nullable(), waterName: z.string().max(200).nullable(),
      checkedCredentialCode: z.string().max(40).nullable(), credentialResult: z.enum(['gueltig', 'ungueltig', 'abgelaufen', 'nicht_geprueft', 'manuell']).nullable(),
      checkedPersonLabel: z.string().max(200).nullable(), tourId: z.string().regex(uuidRe).nullable(), notes: z.string().max(4000).nullable(),
      photoIds: z.array(z.string().regex(uuidRe)).max(10).default([]),
      confirmation: z.object({ method: z.enum(['none', 'pin', 'signature', 'qr']), value: z.string().max(200000).nullable(), at: iso.nullable() }).nullable(),
      status: z.enum(['offen', 'abgeschlossen']),
    }).safeParse(op.data);
    if (!d.success) throw new Rejected('Ungültige Kontrolle.', d.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
    const existing = await one<any>(c, 'SELECT * FROM control WHERE id=$1 FOR UPDATE', [op.entityId]);
    if (existing && existing.warden_person_id !== p.personId) throw new Rejected('Fremde Kontrolle.');
    if (existing?.status === 'abgeschlossen') throw new Rejected('Abgeschlossene Kontrollen können nicht mehr geändert werden (revisionssicher).');
    let permitId: string | null = null, checkedPersonId: string | null = null;
    if (d.data.checkedCredentialCode) {
      const permit = await one<any>(c, 'SELECT id, person_id FROM permit WHERE credential_code = $1', [d.data.checkedCredentialCode]);
      if (permit) { permitId = permit.id; checkedPersonId = permit.person_id; }
    }
    let tourId = d.data.tourId;
    if (tourId && !(await one(c, 'SELECT id FROM tour WHERE id=$1', [tourId]))) tourId = null;
    const vals = [op.entityId, p.personId, d.data.startedAt, d.data.endedAt, d.data.waterKey, d.data.waterName, d.data.checkedCredentialCode, d.data.credentialResult,
      permitId, checkedPersonId, d.data.checkedPersonLabel, tourId, d.data.notes, d.data.photoIds, d.data.confirmation ? JSON.stringify(d.data.confirmation) : null, d.data.status];
    let v = 1;
    if (!existing) {
      await q(c, `INSERT INTO control(id, warden_person_id, started_at, ended_at, water_key, water_name, credential_code, credential_result, permit_id, checked_person_id,
        checked_person_label, tour_id, notes, photo_ids, confirmation, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, vals);
    } else {
      v = existing.version + 1;
      await q(c, `UPDATE control SET started_at=$3, ended_at=$4, water_key=$5, water_name=$6, credential_code=$7, credential_result=$8, permit_id=$9, checked_person_id=$10,
        checked_person_label=$11, tour_id=$12, notes=$13, photo_ids=$14, confirmation=$15, status=$16, version=${v}, updated_at=now() WHERE id=$1 AND warden_person_id=$2`, vals);
    }
    await revision(c, 'control', op.entityId, v, existing ? 'update' : 'create', p, 'app', d.data);
    if (d.data.status === 'abgeschlossen') await audit(c, actorOf(p), 'kontrolle_abgeschlossen', 'control', op.entityId, { gewaesser: d.data.waterName, ergebnis: d.data.credentialResult });
    void ctx;
    return { opId: op.opId, entityId: op.entityId, status: 'applied', version: v };
  },
};

const violationHandler: Handler = {
  perm: 'controls.write',
  async apply(_ctx, c, p, op) {
    const d = z.object({
      controlId: z.string().regex(uuidRe).nullable(), firstName: z.string().trim().max(100).nullable(), lastName: z.string().trim().max(100).nullable(),
      description: z.string().trim().max(4000), photoIds: z.array(z.string().regex(uuidRe)).max(10).default([]),
    }).safeParse(op.data);
    if (!d.success) throw new Rejected('Ungültige Vergehensmeldung.', d.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
    const required = await getSetting<string[]>(c, 'control.violation_required_fields');
    const missing = required.filter((f) => (f === 'photo' ? d.data.photoIds.length === 0 : !String((d.data as any)[f] ?? '').trim()));
    if (missing.length) throw new Rejected('Pflichtfelder fehlen.', missing.map((f) => ({ field: f, message: 'Pflichtfeld' })));
    const existing = await one<any>(c, 'SELECT * FROM violation WHERE id=$1 FOR UPDATE', [op.entityId]);
    if (existing && existing.warden_person_id !== p.personId) throw new Rejected('Fremde Meldung.');
    let controlId = d.data.controlId;
    if (controlId && !(await one(c, 'SELECT id FROM control WHERE id=$1 AND warden_person_id=$2', [controlId, p.personId]))) controlId = null;
    let v = 1;
    if (!existing) {
      await q(c, `INSERT INTO violation(id, control_id, warden_person_id, first_name, last_name, description, photo_ids) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [op.entityId, controlId, p.personId, d.data.firstName || null, d.data.lastName || null, d.data.description, d.data.photoIds]);
    } else {
      v = existing.version + 1;
      await q(c, `UPDATE violation SET control_id=$2, first_name=$3, last_name=$4, description=$5, photo_ids=$6, version=$7, updated_at=now() WHERE id=$1`,
        [op.entityId, controlId, d.data.firstName || null, d.data.lastName || null, d.data.description, d.data.photoIds, v]);
    }
    await revision(c, 'violation', op.entityId, v, existing ? 'update' : 'create', p, 'app', d.data);
    return { opId: op.opId, entityId: op.entityId, status: 'applied', version: v };
  },
};

// ---------------------------------------------------------------- Terminanmeldung

const registrationHandler: Handler = {
  perm: 'events.read',
  async apply(ctx, c, p, op) {
    const d = z.object({ eventId: z.string().regex(uuidRe), participants: z.number().int().min(1).max(20), message: z.string().max(1000).nullable() }).safeParse(op.data);
    if (!d.success) throw new Rejected('Ungültige Anmeldung.');
    if (await one(c, 'SELECT id FROM event_registration WHERE id=$1', [op.entityId])) return { opId: op.opId, entityId: op.entityId, status: 'duplicate', version: 1 };
    const ev = await one<any>(c, 'SELECT * FROM event WHERE id=$1 AND removed_at IS NULL', [d.data.eventId]);
    if (!ev) throw new Rejected('Termin nicht gefunden.');
    const to = await getSetting<string>(c, 'recipients.event_registration');
    const mail = await ctx.mail.send({
      kind: 'terminanmeldung', to, subject: `Anmeldung: ${ev.title} (${formatDateTimeCH(ev.starts_at)})`,
      body: `Anmeldung aus der Fangbuch-App\n\nTermin: ${ev.title}\nDatum: ${formatDateTimeCH(ev.starts_at)}\nOrt: ${ev.location ?? '–'}\nPerson: ${p.displayName}${p.memberNo ? ` (${p.memberNo})` : ''}${p.email ? `\nE-Mail: ${p.email}` : ''}\nPersonen: ${d.data.participants}\n${d.data.message ? `\nNachricht:\n${d.data.message}` : ''}`,
      related: { eventId: ev.id, registrationId: op.entityId },
    });
    await q(c, `INSERT INTO event_registration(id, event_id, person_id, participants, message, mail_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [op.entityId, ev.id, p.personId, d.data.participants, d.data.message, mail.id]);
    return { opId: op.opId, entityId: op.entityId, status: 'applied', version: 1 };
  },
};

const HANDLERS: Record<SyncOp['entity'], Handler> = {
  tour: tourHandler, catch: catchHandler, water_suggestion: waterSuggestionHandler, incident_report: reportHandler,
  control: controlHandler, violation: violationHandler, event_registration: registrationHandler,
};

/** Wendet Operationen der Reihe nach an. Jede Operation ist idempotent (opId). */
export async function applyOps(ctx: AppContext, p: Principal, deviceId: string, ops: SyncOp[]): Promise<SyncOpResult[]> {
  const results: SyncOpResult[] = [];
  for (const op of ops) {
    const prev = await one<any>(ctx.db, 'SELECT result, person_id FROM sync_op WHERE op_id = $1', [op.opId]);
    if (prev) {
      if (prev.person_id !== p.personId) { results.push({ opId: op.opId, entityId: op.entityId, status: 'rejected', message: 'Operation gehört zu einer anderen Person.' }); continue; }
      results.push({ ...prev.result, status: prev.result.status === 'applied' ? 'duplicate' : prev.result.status });
      continue;
    }
    const h = HANDLERS[op.entity];
    let result: SyncOpResult;
    if (h.perm && !has(p, h.perm)) {
      result = { opId: op.opId, entityId: op.entityId, status: 'rejected', message: 'Keine Berechtigung.' };
    } else {
      try {
        result = await tx(ctx.db, async (c) => {
          const r = await h.apply(ctx, c, p, op, deviceId);
          await q(c, 'INSERT INTO sync_op(op_id, person_id, device_id, entity, entity_id, result) VALUES ($1,$2,$3,$4,$5,$6)', [op.opId, p.personId, deviceId, op.entity, op.entityId, JSON.stringify(r)]);
          return r;
        });
      } catch (e: any) {
        if (e instanceof Rejected) {
          result = { opId: op.opId, entityId: op.entityId, status: 'rejected', message: e.message + (e.errors?.length ? ' ' + e.errors.map((x) => x.message).join(' ') : '') };
          // Abgelehnte Operationen werden ebenfalls protokolliert (Wiederholung liefert dasselbe Ergebnis)
          await q(ctx.db, 'INSERT INTO sync_op(op_id, person_id, device_id, entity, entity_id, result) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [op.opId, p.personId, deviceId, op.entity, op.entityId, JSON.stringify(result)]);
        } else throw e;
      }
    }
    results.push(result);
  }
  return results;
}

/** Eigene Datensätze seit Zeitpunkt (für Mehrgeräte-Abgleich und Status der Meldungen). */
export async function pull(ctx: AppContext, p: Principal, since: string | null) {
  const s = since && !Number.isNaN(Date.parse(since)) ? since : '1970-01-01T00:00:00Z';
  const serverTime = ctx.now().toISOString();
  const tours = await q<any>(ctx.db, `SELECT * FROM tour WHERE person_id=$1 AND updated_at > $2 ORDER BY started_at`, [p.personId, s]);
  const catches = await q<any>(ctx.db, `SELECT * FROM catch WHERE person_id=$1 AND updated_at > $2 ORDER BY caught_at`, [p.personId, s]);
  const reports = await q<any>(ctx.db, `SELECT r.id, r.created_at, m.status AS mail_status FROM incident_report r LEFT JOIN mail_outbox m ON m.id = r.mail_id WHERE r.person_id=$1`, [p.personId]);
  const registrations = await q<any>(ctx.db, `SELECT r.id, r.event_id, m.status AS mail_status FROM event_registration r LEFT JOIN mail_outbox m ON m.id = r.mail_id WHERE r.person_id=$1`, [p.personId]);
  const suggestions = await q<any>(ctx.db, `SELECT key, name, status, suggestion_id FROM water WHERE suggested_by=$1`, [p.personId]);
  const conflicts = await q<any>(ctx.db, `SELECT id, entity, entity_id, server_version, client_data, server_data, created_at FROM sync_conflict WHERE person_id=$1 AND resolved_at IS NULL`, [p.personId]);
  const controls = has(p, 'controls.write') ? await q<any>(ctx.db, `SELECT id, status, version, updated_at FROM control WHERE warden_person_id=$1 AND updated_at > $2`, [p.personId, s]) : [];
  return {
    serverTime,
    tours: tours.map(tourDto), catches: catches.map(catchDto),
    reports: reports.map((r) => ({ id: r.id, deliveryStatus: r.mail_status ?? 'nur_admin', createdAt: r.created_at })),
    registrations: registrations.map((r) => ({ id: r.id, eventId: r.event_id, deliveryStatus: r.mail_status })),
    waterSuggestions: suggestions, conflicts, controls,
  };
}

export function tourDto(t: any) {
  return { id: t.id, waterKey: t.water_key, waterName: t.water_name, waterUnverified: t.water_unverified, mapGroup: t.map_group, permitId: t.permit_id,
    startedAt: new Date(t.started_at).toISOString(), endedAt: t.ended_at ? new Date(t.ended_at).toISOString() : null, pauses: t.pauses, outcome: t.outcome, status: t.status,
    version: t.version, updatedAt: new Date(t.updated_at).toISOString(), deleted: !!t.deleted_at };
}
export function catchDto(c: any) {
  return { id: c.id, tourId: c.tour_id, species: c.species, lengthCm: c.length_cm, disposition: c.disposition, caughtAt: new Date(c.caught_at).toISOString(),
    version: c.version, updatedAt: new Date(c.updated_at).toISOString(), deleted: !!c.deleted_at };
}

export { HttpError, zurichDate };
