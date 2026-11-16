import { zurichDate } from '@fvw/shared';
import { audit, SYSTEM, type Actor } from '../audit';
import type { AppContext } from '../context';
import { one, q, tx } from '../db';
import { getSetting } from '../settings';

/**
 * Rücklaufquote (AD §5, PA §13):
 *  - Tageskarten: Karten mit Meldung (inkl. Nullmeldung) ÷ verkaufte Tageskarten.
 *  - Saisonpatente: Personen mit Saisonmeldung ÷ Patente.
 * Fehlende Meldungen werden nur markiert. Es gibt KEINE Folgen/Sanktionen (offen O15).
 */
export async function returnRates(ctx: AppContext, season: number) {
  const s = await one<any>(ctx.db, 'SELECT * FROM season WHERE year=$1', [season]);
  const from = s?.starts_on ?? `${season}-01-01`;
  const to = s?.ends_on ?? `${season}-12-31`;
  const seasonAssumption = !s?.starts_on || !s?.ends_on;
  const permits = await q<any>(ctx.db, `SELECT p.id, p.person_id, p.valid_from, p.valid_to, p.status, t.id AS type_id, t.name AS type_name, t.kind, t.is_demo,
      per.display_name, per.member_no, per.kind AS person_kind, per.anonymized_at
    FROM permit p JOIN permit_type t ON t.id=p.permit_type_id JOIN person per ON per.id=p.person_id
    WHERE p.status <> 'entwurf' AND p.valid_from <= $2 AND p.valid_to >= $1`, [from, to]);
  const tours = await q<any>(ctx.db, `SELECT person_id, started_at, outcome FROM tour WHERE status='closed' AND outcome IS NOT NULL AND deleted_at IS NULL AND started_at >= $1::date - 1 AND started_at < $2::date + 2`, [from, to]);
  const seasonReports = await q<any>(ctx.db, 'SELECT person_id FROM season_report WHERE season_year=$1', [season]);
  const byPerson = new Map<string, string[]>();
  for (const t of tours) byPerson.set(t.person_id, [...(byPerson.get(t.person_id) ?? []), zurichDate(t.started_at)]);
  const reportedSeason = new Set(seasonReports.map((r) => r.person_id));
  const today = zurichDate(ctx.now());
  const groups = new Map<string, any>();
  for (const p of permits) {
    const g = groups.get(p.type_id) ?? { typeId: p.type_id, typeName: p.type_name, kind: p.kind, isDemo: p.is_demo, total: 0, reported: 0, pending: 0, missing: [] as any[] };
    const dates = byPerson.get(p.person_id) ?? [];
    let reported: boolean;
    if (p.kind === 'tag') reported = dates.some((d) => d >= p.valid_from && d <= p.valid_to);
    else reported = reportedSeason.has(p.person_id) || dates.some((d) => d >= from && d <= to);
    const stillOpen = p.kind === 'tag' ? p.valid_to >= today : to >= today;
    g.total++;
    if (reported) g.reported++;
    else {
      if (stillOpen) g.pending++;
      g.missing.push({ permitId: p.id, person: p.anonymized_at ? 'anonymisiert' : `${p.display_name}${p.member_no ? ` (${p.member_no})` : ''}`, validFrom: p.valid_from, validTo: p.valid_to, stillOpen });
    }
    groups.set(p.type_id, g);
  }
  const out = [...groups.values()].map((g) => ({ ...g, rate: g.total ? g.reported / g.total : null }));
  const sum = (k: string) => out.filter((g) => (k === 'tag' ? g.kind === 'tag' : g.kind !== 'tag')).reduce((a, g) => ({ total: a.total + g.total, reported: a.reported + g.reported }), { total: 0, reported: 0 });
  const day = sum('tag'), seasonal = sum('saison');
  return {
    season, from, to, seasonAssumption,
    dayCards: { ...day, rate: day.total ? day.reported / day.total : null },
    seasonPermits: { ...seasonal, rate: seasonal.total ? seasonal.reported / seasonal.total : null },
    byType: out,
    note: 'Fehlende Meldungen werden nur markiert. Ob sie Folgen haben, entscheidet der Vorstand (O15).',
  };
}

/** «Fangmeldung offen»: Tageskarten bzw. Fischtage ohne Meldung (für die App). */
export async function openReportsFor(ctx: AppContext, personId: string) {
  const permits = await q<any>(ctx.db, `SELECT p.id, p.valid_from, p.valid_to, t.name, t.kind FROM permit p JOIN permit_type t ON t.id=p.permit_type_id WHERE p.person_id=$1 AND p.status='aktiv' AND t.kind='tag'`, [personId]);
  const tours = await q<any>(ctx.db, `SELECT started_at FROM tour WHERE person_id=$1 AND status='closed' AND outcome IS NOT NULL AND deleted_at IS NULL`, [personId]);
  const dates = tours.map((t) => zurichDate(t.started_at));
  const today = zurichDate(ctx.now());
  return permits.filter((p) => p.valid_from <= today && !dates.some((d) => d >= p.valid_from && d <= p.valid_to))
    .map((p) => ({ permitId: p.id, name: p.name, validFrom: p.valid_from, validTo: p.valid_to }));
}

// ---------------------------------------------------------------- Aufbewahrung / Gastdaten

/**
 * Löschfristen anwenden – nur wenn der Vorstand Fristen festgelegt hat (sonst nichts tun).
 * Gäste: Personendaten löschen, Fangdaten bleiben anonymisiert für die Statistik.
 */
export async function applyRetention(ctx: AppContext, actor: Actor = SYSTEM, dryRun = false) {
  const guestDays = await getSetting<number | null>(ctx.db, 'guest.retention_days');
  const grace = (await getSetting<number | null>(ctx.db, 'guest.grace_days')) ?? 0;
  const controlDays = await getSetting<number | null>(ctx.db, 'retention.controls_days');
  const reportDays = await getSetting<number | null>(ctx.db, 'retention.reports_days');
  const result: Record<string, unknown> = { guestDays, controlDays, reportDays, dryRun };
  if (guestDays != null) {
    const due = await q<any>(ctx.db, `SELECT per.id, per.auth_user_id FROM person per WHERE per.kind='guest' AND per.anonymized_at IS NULL
      AND (SELECT max(valid_to) FROM permit WHERE person_id=per.id) + ($1::int + $2::int) < current_date`, [guestDays, grace]);
    result.guestsDue = due.length;
    if (!dryRun) for (const g of due) await anonymizePerson(ctx, g.id, actor, 'Löschfrist Gastdaten');
  } else result.guests = 'Frist nicht festgelegt – keine Löschung';
  if (controlDays != null) {
    const r = await q<any>(ctx.db, `SELECT id FROM control WHERE status='abgeschlossen' AND ended_at < now() - ($1 || ' days')::interval`, [String(controlDays)]);
    result.controlsDue = r.length;
    if (!dryRun && r.length) {
      await q(ctx.db, `DELETE FROM violation WHERE control_id = ANY($1)`, [r.map((x) => x.id)]);
      await q(ctx.db, `DELETE FROM control WHERE id = ANY($1)`, [r.map((x) => x.id)]);
      await audit(ctx.db, actor, 'aufbewahrung_kontrollen_geloescht', 'control', null, { anzahl: r.length, frist: controlDays });
    }
  } else result.controls = 'Frist nicht festgelegt – keine Löschung';
  if (reportDays != null) {
    const r = await q<any>(ctx.db, `SELECT id FROM incident_report WHERE created_at < now() - ($1 || ' days')::interval`, [String(reportDays)]);
    result.reportsDue = r.length;
    if (!dryRun && r.length) {
      await q(ctx.db, `DELETE FROM incident_report WHERE id = ANY($1)`, [r.map((x) => x.id)]);
      await audit(ctx.db, actor, 'aufbewahrung_meldungen_geloescht', 'incident_report', null, { anzahl: r.length, frist: reportDays });
    }
  } else result.reports = 'Frist nicht festgelegt – keine Löschung';
  return result;
}

/** Personendaten löschen/anonymisieren; Fang- und Tourdaten bleiben ohne Personenbezug erhalten. */
export async function anonymizePerson(ctx: AppContext, personId: string, actor: Actor, reason: string) {
  await tx(ctx.db, async (c) => {
    const p = await one<any>(c, 'SELECT * FROM person WHERE id=$1 FOR UPDATE', [personId]);
    if (!p || p.anonymized_at) return;
    if (p.auth_user_id) {
      await q(c, 'DELETE FROM "session" WHERE "userId"=$1', [p.auth_user_id]);
      await q(c, 'DELETE FROM "account" WHERE "userId"=$1', [p.auth_user_id]);
      await q(c, 'DELETE FROM "user" WHERE id=$1', [p.auth_user_id]);
    }
    await q(c, `UPDATE person SET email=NULL, display_name=$2, member_no=NULL, eventfrog_email=NULL, auth_user_id=NULL, fairgate_id=NULL, eligible=false, anonymized_at=now(), updated_at=now() WHERE id=$1`,
      [personId, p.kind === 'guest' ? 'Gast (anonymisiert)' : 'Person (anonymisiert)']);
    await q(c, `UPDATE guest_order SET email='anonymisiert', buyer_name=NULL WHERE person_id=$1`, [personId]);
    await q(c, `DELETE FROM push_device WHERE person_id=$1`, [personId]);
    await q(c, `DELETE FROM access_code WHERE person_id=$1`, [personId]);
    await audit(c, actor, 'person_anonymisiert', 'person', personId, { grund: reason, art: p.kind });
  });
}
