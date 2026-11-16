import { formatDateTimeCH } from '@fvw/shared';
import { z } from 'zod';
import { audit, SYSTEM, type Actor } from '../audit';
import { HttpError, type Principal } from '../authz';
import type { AppContext } from '../context';
import { one, q } from '../db';
import { recordError, recordSuccess } from '../integrations/status';
import { getSetting } from '../settings';

export const newsInput = z.object({
  title: z.string().trim().min(2).max(200),
  body: z.string().trim().min(1).max(10000),
  publishedAt: z.string().optional(),
  category: z.enum(['allgemein', 'gewaesserzustand', 'verein', 'sperrung']).default('allgemein'),
  waterKey: z.string().nullable().optional(),
  waterName: z.string().nullable().optional(),
  condition: z.object({
    waterLevel: z.string().max(100).nullable().optional(),
    turbidity: z.string().max(100).nullable().optional(),
    ice: z.string().max(100).nullable().optional(),
    closureNote: z.string().max(500).nullable().optional(),
  }).nullable().optional(),
  visibility: z.enum(['alle', 'mitglieder']).default('alle'),
  expiresAt: z.string().nullable().optional(),
  photoId: z.string().uuid().nullable().optional(),
  important: z.boolean().default(false),
});

export function newsDto(r: any, now: Date) {
  const expired = !!r.expires_at && new Date(r.expires_at).getTime() <= now.getTime();
  return {
    id: r.id, title: r.title, body: r.body, publishedAt: new Date(r.published_at).toISOString(), category: r.category, waterKey: r.water_key, waterName: r.water_name,
    condition: r.condition, visibility: r.visibility, expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null, expired,
    photoId: r.photo_id, important: r.important, updatedAt: new Date(r.updated_at).toISOString(), version: r.version,
  };
}

export async function listNews(ctx: AppContext, p: Principal) {
  const membersOnly = p.permissions.includes('news.read_members');
  const rows = await q<any>(ctx.db, `SELECT * FROM news WHERE deleted_at IS NULL AND published_at <= now() + interval '1 minute' ${membersOnly ? '' : `AND visibility='alle'`}
    ORDER BY published_at DESC LIMIT 200`);
  return rows.map((r) => newsDto(r, ctx.now()));
}

export async function saveNews(ctx: AppContext, actor: Actor, input: z.infer<typeof newsInput>, id?: string) {
  if (input.category === 'gewaesserzustand' && !input.waterKey) throw new HttpError(400, 'water_required', 'Für den Gewässerzustand bitte ein Gewässer wählen.');
  const vals = [input.title, input.body, input.publishedAt ?? new Date().toISOString(), input.category, input.waterKey ?? null, input.waterName ?? null,
    input.condition ? JSON.stringify(input.condition) : null, input.visibility, input.expiresAt || null, input.photoId ?? null, input.important];
  let row: any;
  if (id) {
    row = await one(ctx.db, `UPDATE news SET title=$2, body=$3, published_at=$4, category=$5, water_key=$6, water_name=$7, condition=$8, visibility=$9, expires_at=$10, photo_id=$11, important=$12,
      version=version+1, updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING *`, [id, ...vals]);
    if (!row) throw new HttpError(404, 'not_found', 'Beitrag nicht gefunden.');
  } else {
    row = await one(ctx.db, `INSERT INTO news(title, body, published_at, category, water_key, water_name, condition, visibility, expires_at, photo_id, important, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [...vals, actor.personId]);
  }
  await audit(ctx.db, actor, id ? 'news_geaendert' : 'news_erstellt', 'news', row.id, { titel: input.title, kategorie: input.category, sichtbarkeit: input.visibility });
  if (input.important && !id && (await getSetting<boolean>(ctx.db, 'news.push_important'))) {
    const r = await ctx.push.send({ kind: 'news', title: input.title, body: input.body.slice(0, 180), audience: input.visibility, related: { newsId: row.id } });
    await q(ctx.db, 'UPDATE news SET push_status=$2 WHERE id=$1', [row.id, r.status]);
  }
  return newsDto(row, ctx.now());
}

export async function deleteNews(ctx: AppContext, actor: Actor, id: string) {
  await q(ctx.db, 'UPDATE news SET deleted_at=now(), version=version+1 WHERE id=$1', [id]);
  await audit(ctx.db, actor, 'news_geloescht', 'news', id);
}

// ---------------------------------------------------------------- Termine

export async function syncEvents(ctx: AppContext, actor: Actor = SYSTEM) {
  const d = ctx.website.describe();
  if (!d.configured) { await recordError(ctx.db, 'website', `Termine nicht abrufbar: ${d.detail}`); return { ok: false, message: d.detail }; }
  try {
    const events = await ctx.website.fetchEvents();
    const source = ctx.website.mode === 'demo' ? 'demo' : 'website';
    const ids: string[] = [];
    for (const e of events) {
      ids.push(e.externalId);
      await q(ctx.db, `INSERT INTO event(external_id, source, title, starts_at, ends_at, all_day, location, url, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (source, external_id) DO UPDATE SET title=EXCLUDED.title, starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at, all_day=EXCLUDED.all_day,
        location=EXCLUDED.location, url=EXCLUDED.url, description=EXCLUDED.description, fetched_at=now(), removed_at=NULL`,
        [e.externalId, source, e.title, e.startsAt, e.endsAt, e.allDay, e.location, e.url, e.description]);
    }
    await q(ctx.db, `UPDATE event SET removed_at=now() WHERE source=$1 AND removed_at IS NULL AND NOT (external_id = ANY($2)) AND starts_at > now()`, [source, ids]);
    await recordSuccess(ctx.db, 'website', `${events.length} Termine gelesen${d.fragile ? ' (Seite ausgelesen – störanfällig)' : ''}`);
    void actor;
    return { ok: true, count: events.length };
  } catch (e: any) {
    await recordError(ctx.db, 'website', `Termine konnten nicht gelesen werden: ${e.message}`);
    return { ok: false, message: e.message };
  }
}

export async function listEvents(ctx: AppContext) {
  const rows = await q<any>(ctx.db, `SELECT * FROM event WHERE removed_at IS NULL AND coalesce(ends_at, starts_at) >= now() - interval '1 day' ORDER BY starts_at LIMIT 50`);
  return rows.map((r) => ({
    id: r.id, title: r.title, startsAt: new Date(r.starts_at).toISOString(), endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : null, allDay: r.all_day,
    location: r.location, url: r.url, description: r.description, source: r.source, registrationEnabled: r.registration_enabled,
  }));
}

/** iCalendar-Datei für «In Kalender übernehmen». */
export function eventIcs(e: { id: string; title: string; startsAt: string; endsAt: string | null; allDay: boolean; location: string | null; url: string | null; description: string | null }) {
  const f = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const end = e.endsAt ?? new Date(Date.parse(e.startsAt) + 2 * 3600_000).toISOString();
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FV Werdenberg//Fangbuch-App//DE', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${e.id}@fangbuch.fvw`, `DTSTAMP:${f(new Date().toISOString())}`,
    e.allDay ? `DTSTART;VALUE=DATE:${e.startsAt.slice(0, 10).replace(/-/g, '')}` : `DTSTART:${f(e.startsAt)}`,
    e.allDay ? `DTEND;VALUE=DATE:${end.slice(0, 10).replace(/-/g, '')}` : `DTEND:${f(end)}`,
    `SUMMARY:${esc(e.title)}`, e.location ? `LOCATION:${esc(e.location)}` : '', e.url ? `URL:${e.url}` : '',
    e.description ? `DESCRIPTION:${esc(e.description)}` : '', 'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n') + '\r\n';
}

export { formatDateTimeCH };
