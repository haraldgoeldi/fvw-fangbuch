import { createHash, randomBytes, randomInt } from 'node:crypto';
import { zurichDate } from '@fvw/shared';
import { audit, SYSTEM, type Actor } from '../audit';
import { guestAccessUntil, HttpError, revokeSessions } from '../authz';
import type { AppContext } from '../context';
import { one, q, tx } from '../db';
import { recordError, recordSuccess } from '../integrations/status';
import { getSetting } from '../settings';

const normEmail = (e: string) => e.trim().toLowerCase();
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Kurze, gut lesbare Ausweis-Prüfnummer (ohne verwechselbare Zeichen). */
export function newCredentialCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += alphabet[randomInt(alphabet.length)];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

// ---------------------------------------------------------------- Fairgate-Abgleich

export async function syncMembers(ctx: AppContext, actor: Actor = SYSTEM) {
  const desc = ctx.fairgate.describe();
  if (!desc.configured) {
    await recordError(ctx.db, 'fairgate', `Abgleich nicht möglich: ${desc.detail}`);
    return { ok: false, message: desc.detail };
  }
  let contacts;
  try {
    contacts = await ctx.fairgate.fetchContacts();
  } catch (e: any) {
    await recordError(ctx.db, 'fairgate', `Abgleich fehlgeschlagen: ${e.message}`);
    return { ok: false, message: e.message };
  }
  const eligibleStatuses = await getSetting<string[]>(ctx.db, 'members.eligible_statuses');
  const seen = new Set<string>();
  let created = 0, updated = 0, revoked = 0;
  await tx(ctx.db, async (c) => {
    for (const k of contacts) {
      seen.add(k.fairgateId);
      const eligible = eligibleStatuses.includes(k.status);
      const name = `${k.firstName} ${k.lastName}`.trim() || k.memberNo || 'Mitglied';
      const existing = await one<any>(c, 'SELECT * FROM person WHERE fairgate_id = $1', [k.fairgateId]);
      if (!existing) {
        await q(c, `INSERT INTO person(kind, email, display_name, member_no, fairgate_id, fairgate_status, fairgate_groups, eligible, source, last_sync_at)
          VALUES ('member',$1,$2,$3,$4,$5,$6,$7,$8, now())`,
          [k.email, name, k.memberNo, k.fairgateId, k.status, k.groups, eligible, ctx.fairgate.mode === 'demo' ? 'demo' : 'fairgate']);
        created++;
      } else {
        await q(c, `UPDATE person SET email=$2, display_name=$3, member_no=$4, fairgate_status=$5, fairgate_groups=$6, eligible=$7, last_sync_at=now(), updated_at=now() WHERE id=$1`,
          [existing.id, k.email, name, k.memberNo, k.status, k.groups, eligible]);
        updated++;
        if (existing.eligible && !eligible) {
          revoked++;
          await revokeSessions(c, existing.auth_user_id);
          await audit(c, actor, 'zugang_entzogen', 'person', existing.id, { grund: `Fairgate-Status «${k.status}»` });
        }
      }
    }
    // Nicht mehr gelieferte Kontakte: Zugang entziehen (Austritt)
    const gone = await q<any>(c, `SELECT id, auth_user_id FROM person WHERE kind='member' AND fairgate_id IS NOT NULL AND eligible AND NOT (fairgate_id = ANY($1))`, [[...seen]]);
    for (const g of gone) {
      await q(c, `UPDATE person SET eligible=false, updated_at=now() WHERE id=$1`, [g.id]);
      await revokeSessions(c, g.auth_user_id);
      await audit(c, actor, 'zugang_entzogen', 'person', g.id, { grund: 'nicht mehr in Fairgate' });
      revoked++;
    }
  });
  await recordSuccess(ctx.db, 'fairgate', `Abgleich: ${contacts.length} Kontakte (${created} neu, ${updated} aktualisiert, ${revoked} Zugänge entzogen)`);
  await audit(ctx.db, actor, 'fairgate_abgleich', null, null, { kontakte: contacts.length, neu: created, entzogen: revoked });
  return { ok: true, total: contacts.length, created, updated, revoked };
}

// ---------------------------------------------------------------- Eventfrog-Abgleich (Tageskarten)

/** Datum in Zürcher Zeit, um `days` Tage verschoben (YYYY-MM-DD). */
function shiftDay(ctx: AppContext, days: number) {
  return zurichDate(new Date(ctx.now().getTime() + days * 86400_000));
}

/**
 * Welche Tageskarten-Events der Gruppe abgefragt werden (Event-Datum):
 * - «kurz» (alle 30 Minuten): gestern bis «Tage im Voraus» (Einstellung, Standard 14),
 * - «voll» (einmal pro Nacht): vor 3 Tagen bis in 400 Tagen (Vorverkauf, Stornierungen),
 * - «sofort» (beim Einlesen eines Tickets): gestern bis übermorgen.
 */
export type SyncWindow = 'kurz' | 'voll' | 'sofort';
async function windowDates(ctx: AppContext, w: SyncWindow) {
  if (w === 'voll') return { fromDate: shiftDay(ctx, -3), toDate: shiftDay(ctx, 400) };
  if (w === 'sofort') return { fromDate: shiftDay(ctx, -1), toDate: shiftDay(ctx, 2) };
  const ahead = (await getSetting<number | null>(ctx.db, 'eventfrog.sync_days_ahead')) ?? 14;
  return { fromDate: shiftDay(ctx, -1), toDate: shiftDay(ctx, ahead) };
}

export async function syncGuestOrders(ctx: AppContext, actor: Actor = SYSTEM, window: SyncWindow = 'kurz') {
  const desc = ctx.eventfrog.describe();
  if (!desc.configured) {
    await recordError(ctx.db, 'eventfrog', `Abgleich nicht möglich: ${desc.detail}`);
    return { ok: false, message: desc.detail };
  }
  let orders;
  try {
    orders = await ctx.eventfrog.fetchOrders({
      eventIds: (await getSetting<string[] | null>(ctx.db, 'eventfrog.event_ids')) ?? [],
      groupIds: (await getSetting<string[] | null>(ctx.db, 'eventfrog.group_ids')) ?? [],
      ...(await windowDates(ctx, window)),
      dateField: await getSetting<string | null>(ctx.db, 'eventfrog.date_field'),
    });
  } catch (e: any) {
    await recordError(ctx.db, 'eventfrog', `Abgleich fehlgeschlagen: ${e.message}`);
    return { ok: false, message: e.message };
  }
  const source = ctx.eventfrog.mode === 'demo' ? 'demo' : 'eventfrog';
  let created = 0, unmapped = 0, cancelled = 0;
  const season = await getSetting<number>(ctx.db, 'season.current_year');
  for (const o of orders) {
    await tx(ctx.db, async (c) => {
      const email = normEmail(o.email);
      const ext = `${o.orderId}/${o.ticketNo ?? ''}`;
      const existing = await one<any>(c, `SELECT id, status FROM permit WHERE source=$1 AND external_ref=$2`, [source === 'demo' ? 'demo' : 'eventfrog', ext]);
      if (o.cancelled && !existing) return; // storniert, bevor die App es gesehen hat: nichts anlegen
      let guest = await one<any>(c, `SELECT * FROM person WHERE kind='guest' AND lower(email)=$1 AND anonymized_at IS NULL`, [email]);
      if (!guest) {
        guest = await one<any>(c, `INSERT INTO person(kind, email, display_name, eventfrog_email, source) VALUES ('guest',$1,$2,$1,$3) RETURNING *`,
          [email, o.buyerName?.trim() || 'Gast', source === 'demo' ? 'demo' : 'eventfrog']);
      }
      // Zuordnung über den Namen der Ticketkategorie oder deren Eventfrog-ID
      const type = await one<any>(c, `SELECT * FROM permit_type WHERE eventfrog_ticket_type = ANY($1::text[]) AND status <> 'archiviert' ORDER BY created_at LIMIT 1`,
        [[o.ticketType, o.categoryId].filter((x): x is string => !!x)]);
      let permitId: string | null = null;
      if (o.cancelled) {
        // In Eventfrog storniert: bestehende Tageskarte sperren, keine neue anlegen
        if (existing.status !== 'gesperrt') {
          await q(c, `UPDATE permit SET status='gesperrt', note=trim(concat(note, ' In Eventfrog storniert.')) WHERE id=$1`, [existing.id]);
          cancelled++;
        }
        permitId = existing.id;
      } else if (type) {
        if (existing) permitId = existing.id;
        else {
          const seasonYear = Number(o.validFrom.slice(0, 4));
          await q(c, `INSERT INTO season(year, label) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [seasonYear, `Saison ${seasonYear}`]);
          const np = await one<any>(c, `INSERT INTO permit(person_id, permit_type_id, season_year, valid_from, valid_to, status, payment_status, source, external_ref, credential_code)
            VALUES ($1,$2,$3,$4,$5,'aktiv','über Eventfrog',$6,$7,$8) RETURNING id`,
            [guest.id, type.id, seasonYear, o.validFrom, o.validTo, source === 'demo' ? 'demo' : 'eventfrog', ext, newCredentialCode()]);
          permitId = np!.id;
          created++;
        }
      } else unmapped++;
      await q(c, `INSERT INTO guest_order(external_order_id, ticket_no, email, buyer_name, ticket_type, valid_from, valid_to, source, person_id, permit_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (source, external_order_id, ticket_no) DO UPDATE SET person_id=EXCLUDED.person_id, permit_id=EXCLUDED.permit_id, fetched_at=now()`,
        [o.orderId, o.ticketNo, email, o.buyerName, o.ticketType, o.validFrom, o.validTo, source, guest.id, permitId]);
    });
  }
  const msg = `Abgleich: ${orders.length} Tickets, ${created} neue Tageskarten${cancelled ? `, ${cancelled} storniert und gesperrt` : ''}${unmapped ? `, ${unmapped} ohne zugeordnete Patentart` : ''}`;
  await recordSuccess(ctx.db, 'eventfrog', msg);
  if (unmapped) await q(ctx.db, `INSERT INTO integration_log(key, level, message) VALUES ('eventfrog','warnung',$1)`, [`${unmapped} Bestellungen mit Ticketart ohne Patentart-Zuordnung (Admin → Patentarten)`]);
  void season;
  return { ok: true, total: orders.length, created, cancelled, unmapped };
}

// ---------------------------------------------------------------- Anmeldung

export type Eligibility = { kind: 'member' | 'guest'; personId: string } | null;

/** Prüft zuerst Fairgate (Mitglied), danach eine gültige Tageskarte (Eventfrog). */
export async function resolveEligibility(ctx: AppContext, rawEmail: string): Promise<Eligibility> {
  const email = normEmail(rawEmail);
  const member = await one<any>(ctx.db, `SELECT id FROM person WHERE kind='member' AND lower(email)=$1 AND eligible AND anonymized_at IS NULL`, [email]);
  if (member) return { kind: 'member', personId: member.id };
  const guest = await one<any>(ctx.db, `SELECT id FROM person WHERE kind='guest' AND lower(email)=$1 AND anonymized_at IS NULL`, [email]);
  if (guest) {
    const until = await guestAccessUntil(ctx.db, guest.id);
    if (until && until >= zurichDate(ctx.now())) return { kind: 'guest', personId: guest.id };
  }
  return null;
}

/** Ersatzweg: Gast meldet sich mit Ticketnummer an (Code geht trotzdem an die Bestell-E-Mail). */
export async function emailForTicket(ctx: AppContext, ticketNo: string): Promise<string | null> {
  const r = await one<{ email: string }>(ctx.db, `SELECT email FROM guest_order WHERE upper(ticket_no) = upper($1) ORDER BY fetched_at DESC LIMIT 1`, [ticketNo.trim()]);
  return r?.email ?? null;
}

/**
 * Sofort-Abgleich, wenn ein Gast ein eben gekauftes Ticket einliest oder sich mit der Bestell-E-Mail
 * anmeldet, die der Server noch nicht kennt. Fragt nur die Tageskarten-Events von gestern bis übermorgen ab
 * und läuft höchstens alle 20 Sekunden (Eventfrog-Limite). Fehler werden nur protokolliert.
 */
let lastLiveLookup = 0;
const liveLookupsPerDay = new Map<string, number>();
export async function liveGuestLookup(ctx: AppContext): Promise<boolean> {
  if (ctx.eventfrog.mode === 'off' || !ctx.eventfrog.describe().configured) return false;
  const now = ctx.now().getTime();
  if (now - lastLiveLookup < 20_000) return false;
  // höchstens 150 Sofort-Abgleiche pro Tag (je ca. 2–5 Anfragen), damit das Tageslimit für den Abgleich bleibt
  const day = zurichDate(ctx.now());
  const count = liveLookupsPerDay.get(day) ?? 0;
  if (count >= 150) return false;
  liveLookupsPerDay.clear();
  liveLookupsPerDay.set(day, count + 1);
  lastLiveLookup = now;
  const r = await syncGuestOrders(ctx, SYSTEM, 'sofort');
  return r.ok;
}
export function resetLiveLookupForTest() { lastLiveLookup = 0; liveLookupsPerDay.clear(); }

/** E-Mail zur Ticketnummer; unbekannte Nummern werden sofort bei Eventfrog nachgeschlagen. */
export async function emailForTicketLive(ctx: AppContext, ticketNo: string): Promise<string | null> {
  return (await emailForTicket(ctx, ticketNo)) ?? ((await liveGuestLookup(ctx)) ? await emailForTicket(ctx, ticketNo) : null);
}

/**
 * Anmeldung allein mit der Ticketnummer (Einstellung «Ticket genügt»): Wer die Nummer des Tickets hat,
 * wird ohne E-Mail-Code als Gast angemeldet, solange die Tageskarte gilt (inkl. Nachmeldefrist).
 */
export async function loginWithTicket(ctx: AppContext, ticketNo: string, deviceLabel: string | null) {
  rateLimit('ticketlogin', ctx.cfg.DEMO_MODE ? 500 : 30, 15 * 60_000);
  rateLimit(`ticketlogin:${ticketNo.trim().toUpperCase()}`, ctx.cfg.DEMO_MODE ? 200 : 10, 15 * 60_000);
  if ((await getSetting<string>(ctx.db, 'guest.ticket_login')) !== 'ticket_genuegt') {
    throw new HttpError(400, 'code_required', 'Bitte den Code aus der E-Mail der Bestellung verwenden.');
  }
  const email = await emailForTicketLive(ctx, ticketNo);
  const row = email ? await one<any>(ctx.db, `SELECT o.person_id, p.status FROM guest_order o LEFT JOIN permit p ON p.id = o.permit_id
    WHERE upper(o.ticket_no) = upper($1) ORDER BY o.fetched_at DESC LIMIT 1`, [ticketNo.trim()]) : null;
  const elig = email ? await resolveEligibility(ctx, email) : null;
  if (!row?.person_id || row.status !== 'aktiv' || !elig || elig.kind !== 'guest' || elig.personId !== row.person_id) {
    throw new HttpError(400, 'invalid_ticket', 'Zu dieser Ticketnummer gibt es keine gültige Tageskarte. Bitte Nummer prüfen oder später erneut versuchen.');
  }
  const authCtx = await ctx.auth.$context;
  const existing = await authCtx.internalAdapter.findUserByEmail(email!);
  const user = existing?.user ?? (await authCtx.internalAdapter.createUser({ email: email!, name: '', emailVerified: false }, { method: 'ticket' } as any));
  const session = await authCtx.internalAdapter.createSession(user.id);
  await linkPerson(ctx, elig.personId, user.id, email);
  await audit(ctx.db, { personId: elig.personId, label: 'Ticketnummer' }, 'anmeldung', 'person', elig.personId, { geraet: deviceLabel, art: 'ticket' });
  return { token: session.token };
}

const attempts = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()) {
  const list = (attempts.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw new HttpError(429, 'rate_limited', 'Zu viele Versuche. Bitte in einigen Minuten erneut versuchen.');
  list.push(now);
  attempts.set(key, list);
}

export async function requestLoginCode(ctx: AppContext, email: string) {
  const e = normEmail(email);
  rateLimit(`code:${e}`, ctx.cfg.DEMO_MODE ? 200 : 5, 15 * 60_000);
  let elig = await resolveEligibility(ctx, e);
  // Eben gekauft? Dann kennt der Server die Bestellung evtl. noch nicht → sofort bei Eventfrog nachfragen.
  if (!elig && (await liveGuestLookup(ctx))) elig = await resolveEligibility(ctx, e);
  if (!elig) {
    await audit(ctx.db, SYSTEM, 'login_abgelehnt', null, null, { emailHash: sha256(e).slice(0, 12) });
    return { sent: false };
  }
  await ctx.auth.api.sendVerificationOTP({ body: { email: e, type: 'sign-in' } });
  return { sent: true };
}

export async function verifyLoginCode(ctx: AppContext, email: string, code: string, deviceLabel: string | null) {
  const e = normEmail(email);
  rateLimit(`verify:${e}`, ctx.cfg.DEMO_MODE ? 200 : 10, 15 * 60_000);
  const elig = await resolveEligibility(ctx, e);
  if (!elig) throw new HttpError(403, 'not_eligible', 'Diese E-Mail ist nicht (mehr) für die App freigeschaltet.');
  let res: { token: string; user: { id: string } };
  try {
    res = (await ctx.auth.api.signInEmailOTP({ body: { email: e, otp: code.trim() } })) as any;
  } catch {
    throw new HttpError(400, 'invalid_code', 'Der Code ist ungültig oder abgelaufen.');
  }
  await linkPerson(ctx, elig.personId, res.user.id, e);
  await audit(ctx.db, { personId: elig.personId, label: e }, 'anmeldung', 'person', elig.personId, { geraet: deviceLabel, art: elig.kind });
  return { token: res.token };
}

async function linkPerson(ctx: AppContext, personId: string, authUserId: string, email: string | null) {
  const p = await one<any>(ctx.db, 'SELECT * FROM person WHERE id = $1', [personId]);
  if (p.auth_user_id && p.auth_user_id !== authUserId) {
    // E-Mail hat sich geändert → bestehende Verknüpfung lösen
    await q(ctx.db, 'UPDATE person SET auth_user_id = NULL WHERE auth_user_id = $1 AND id <> $2', [authUserId, personId]);
  }
  await q(ctx.db, 'UPDATE person SET auth_user_id = NULL WHERE auth_user_id = $1 AND id <> $2', [authUserId, personId]);
  await q(ctx.db, 'UPDATE person SET auth_user_id = $2, updated_at = now() WHERE id = $1', [personId, authUserId]);
  // Admin-Bootstrap (nur bei Rollenquelle «App»)
  if (email && ctx.cfg.adminBootstrapEmails.includes(email) && p.kind === 'member' && !p.roles.includes('admin')
    && (await getSetting<string>(ctx.db, 'roles.source')) === 'app') {
    await q(ctx.db, `UPDATE person SET roles = array_append(roles, 'admin') WHERE id = $1`, [personId]);
    await audit(ctx.db, SYSTEM, 'rolle_vergeben', 'person', personId, { rolle: 'admin', grund: 'ADMIN_BOOTSTRAP_EMAILS' });
  }
}

// ---------------------------------------------------------------- Plan B: Zugangscode vom Vorstand

export async function createAccessCode(ctx: AppContext, personId: string, actor: Actor, validDays = 14) {
  const person = await one<any>(ctx.db, `SELECT * FROM person WHERE id=$1 AND kind='member' AND eligible`, [personId]);
  if (!person) throw new HttpError(404, 'not_found', 'Berechtigtes Mitglied nicht gefunden.');
  const code = randomBytes(6).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, 'X').slice(0, 8);
  await q(ctx.db, `UPDATE access_code SET used_at = now() WHERE person_id = $1 AND used_at IS NULL`, [personId]);
  await q(ctx.db, `INSERT INTO access_code(person_id, code_hash, expires_at, created_by) VALUES ($1,$2, now() + ($3 || ' days')::interval, $4)`,
    [personId, sha256(code), String(validDays), actor.personId]);
  await audit(ctx.db, actor, 'zugangscode_erstellt', 'person', personId, { gueltigTage: validDays });
  return { code, validDays };
}

export async function loginWithAccessCode(ctx: AppContext, code: string) {
  rateLimit('accesscode', 20, 15 * 60_000);
  const row = await one<any>(ctx.db, `SELECT a.*, p.eligible, p.auth_user_id, p.email FROM access_code a JOIN person p ON p.id = a.person_id
    WHERE a.code_hash = $1 AND a.used_at IS NULL AND a.expires_at > now()`, [sha256(code.trim().toUpperCase())]);
  if (!row || !row.eligible) throw new HttpError(400, 'invalid_code', 'Der Zugangscode ist ungültig oder abgelaufen.');
  const authCtx = await ctx.auth.$context;
  let userId = row.auth_user_id as string | null;
  if (!userId) {
    const email = row.email ?? `${row.person_id}@zugang.fvw.invalid`;
    const existing = await authCtx.internalAdapter.findUserByEmail(email);
    const user = existing?.user ?? (await authCtx.internalAdapter.createUser({ email, name: '', emailVerified: true }, { method: 'access-code' } as any));
    userId = user.id;
  }
  const session = await authCtx.internalAdapter.createSession(userId!);
  await q(ctx.db, 'UPDATE access_code SET used_at = now() WHERE id = $1', [row.id]);
  await linkPerson(ctx, row.person_id, userId!, row.email);
  await audit(ctx.db, { personId: row.person_id, label: 'Zugangscode' }, 'anmeldung', 'person', row.person_id, { art: 'zugangscode' });
  return { token: session.token };
}
