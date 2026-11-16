import { permissionsFor, zurichDate, type Permission, type Role } from '@fvw/shared';
import type { Context, MiddlewareHandler } from 'hono';
import type { Actor } from './audit';
import type { AppContext } from './context';
import { one, q, type Queryable } from './db';
import { getSetting } from './settings';

export interface Principal {
  personId: string;
  authUserId: string;
  kind: 'member' | 'guest';
  displayName: string;
  email: string | null;
  memberNo: string | null;
  roles: Role[];
  permissions: Permission[];
  /** Für Gäste: Zugang gültig bis (YYYY-MM-DD, inkl.). */
  accessUntil: string | null;
  sessionExpiresAt: string;
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export function actorOf(p: Principal): Actor {
  return { personId: p.personId, label: `${p.displayName}${p.memberNo ? ` (${p.memberNo})` : ''}` };
}

/** Rollen einer Person je nach Rollenquelle (App-Pflege oder Fairgate-Gruppe). */
export async function rolesOf(db: Queryable, person: { kind: string; roles: string[]; fairgate_groups: string[] }): Promise<Role[]> {
  if (person.kind === 'guest') return ['guest'];
  const roles: Role[] = ['member'];
  const source = await getSetting<string>(db, 'roles.source');
  if (source === 'fairgate') {
    const w = await getSetting<string | null>(db, 'roles.fairgate_group_warden');
    const a = await getSetting<string | null>(db, 'roles.fairgate_group_admin');
    if (w && person.fairgate_groups.includes(w)) roles.push('warden');
    if (a && person.fairgate_groups.includes(a)) roles.push('admin');
  } else {
    for (const r of person.roles) if ((r === 'warden' || r === 'admin') && !roles.includes(r)) roles.push(r);
  }
  return roles;
}

/** Gastzugang: Gültigkeit der Tageskarte(n) + Nachmeldefrist (nicht festgelegt → 0 Tage). */
export async function guestAccessUntil(db: Queryable, personId: string): Promise<string | null> {
  const r = await one<{ until: string | null }>(db,
    `SELECT max(valid_to)::text AS until FROM permit WHERE person_id = $1 AND status = 'aktiv'`, [personId]);
  if (!r?.until) return null;
  const grace = (await getSetting<number | null>(db, 'guest.grace_days')) ?? 0;
  const d = new Date(`${r.until}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + grace);
  return d.toISOString().slice(0, 10);
}

export async function loadPrincipal(ctx: AppContext, authUserId: string, sessionExpiresAt: string): Promise<Principal> {
  const person = await one<any>(ctx.db, 'SELECT * FROM person WHERE auth_user_id = $1', [authUserId]);
  if (!person || person.anonymized_at) throw new HttpError(401, 'no_person', 'Kein Konto gefunden. Bitte erneut anmelden.');
  if (person.kind === 'member' && !person.eligible) throw new HttpError(403, 'access_revoked', 'Der Zugang ist nicht mehr berechtigt (Austritt oder Sperre laut Mitgliederverwaltung).');
  let accessUntil: string | null = null;
  if (person.kind === 'guest') {
    accessUntil = await guestAccessUntil(ctx.db, person.id);
    if (!accessUntil || accessUntil < zurichDate(ctx.now())) throw new HttpError(403, 'guest_expired', 'Der Gastzugang ist abgelaufen.');
  }
  const roles = await rolesOf(ctx.db, person);
  return {
    personId: person.id, authUserId, kind: person.kind, displayName: person.display_name, email: person.email, memberNo: person.member_no,
    roles, permissions: permissionsFor(roles, person.extra_permissions, person.revoked_permissions), accessUntil, sessionExpiresAt,
  };
}

type Env = { Variables: { principal: Principal; app: AppContext } };

export function authMiddleware(ctx: AppContext): MiddlewareHandler<Env> {
  return async (c, next) => {
    const session = await ctx.auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) throw new HttpError(401, 'unauthenticated', 'Nicht angemeldet oder Sitzung abgelaufen.');
    const p = await loadPrincipal(ctx, session.user.id, new Date(session.session.expiresAt).toISOString());
    c.set('principal', p);
    await next();
  };
}

export function requirePerm(...perms: Permission[]): MiddlewareHandler<Env> {
  return async (c, next) => {
    const p = c.get('principal');
    if (!p || !perms.every((x) => p.permissions.includes(x))) throw new HttpError(403, 'forbidden', 'Keine Berechtigung für diese Funktion.');
    await next();
  };
}

export function principal(c: Context<Env>): Principal {
  return c.get('principal');
}

export function has(p: Principal, perm: Permission) {
  return p.permissions.includes(perm);
}

/** Entzieht alle Sitzungen einer Person (Austritt, Sperre, Rollenänderung). */
export async function revokeSessions(db: Queryable, authUserId: string | null) {
  if (!authUserId) return 0;
  const r = await q(db, 'DELETE FROM "session" WHERE "userId" = $1 RETURNING id', [authUserId]);
  return r.length;
}

export type { Env };
