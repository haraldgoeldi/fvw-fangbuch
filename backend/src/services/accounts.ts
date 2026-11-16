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

export async function syncGuestOrders(ctx: AppContext, actor: Actor = SYSTEM) {
  const desc = ctx.eventfrog.describe();
  if (!desc.configured) {
    await recordError(ctx.db, 'eventfrog', `Abgleich nicht möglich: ${desc.detail}`);
    return { ok: false, message: desc.detail };
  }
  let orders;
  try {
    orders = await ctx.eventfrog.fetchOrders(null);
  } catch (e: any) {
    await recordError(ctx.db, 'eventfrog', `Abgleich fehlgeschlagen: ${e.message}`);
    return { ok: false, message: e.message };
  }
  const source = ctx.eventfrog.mode === 'demo' ? 'demo' : 'eventfrog';
  let created = 0, unmapped = 0;
  const season = await getSetting<number>(ctx.db, 'season.current_year');
  for (const o of orders) {
    await tx(ctx.db, async (c) => {
      const email = normEmail(o.email);
      let guest = await one<any>(c, `SELECT * FROM person WHERE kind='guest' AND lower(email)=$1 AND anonymized_at IS NULL`, [email]);
      if (!guest) {
        guest = await one<any>(c, `INSERT INTO person(kind, email, display_name, eventfrog_email, source) VALUES ('guest',$1,$2,$1,$3) RETURNING *`,
          [email, o.buyerName?.trim() || 'Gast', source === 'demo' ? 'demo' : 'eventfrog']);
      }
      const type = await one<any>(c, `SELECT * FROM permit_type WHERE eventfrog_ticket_type = $1 AND status <> 'archiviert' ORDER BY created_at LIMIT 1`, [o.ticketType]);
      let permitId: string | null = null;
      if (type) {
        const ext = `${o.orderId}/${o.ticketNo ?? ''}`;
        const p = await one<any>(c, `SELECT id FROM permit WHERE source=$1 AND external_ref=$2`, [source === 'demo' ? 'demo' : 'eventfrog', ext]);
        if (p) permitId = p.id;
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
  const msg = `Abgleich: ${orders.length} Bestellungen, ${created} neue Tageskarten${unmapped ? `, ${unmapped} ohne zugeordnete Patentart` : ''}`;
  await recordSuccess(ctx.db, 'eventfrog', msg);
  if (unmapped) await q(ctx.db, `INSERT INTO integration_log(key, level, message) VALUES ('eventfrog','warnung',$1)`, [`${unmapped} Bestellungen mit Ticketart ohne Patentart-Zuordnung (Admin → Patentarten)`]);
  void season;
  return { ok: true, total: orders.length, created, unmapped };
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
  const elig = await resolveEligibility(ctx, e);
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
