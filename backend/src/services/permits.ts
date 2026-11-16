import { zurichDate, type MapGroup } from '@fvw/shared';
import type { Principal } from '../authz';
import type { AppContext } from '../context';
import { q, type Queryable } from '../db';

export interface PermitDto {
  id: string;
  typeName: string;
  typeKind: string;
  typeStatus: string;
  isDemo: boolean;
  mapGroup: MapGroup | null;
  validFrom: string;
  validTo: string;
  status: string;
  paymentStatus: string;
  source: string;
  externalRef: string | null;
  credentialCode: string;
  /** Signierter Ausweis für die Offline-Kontrolle (QR-Code). */
  credentialToken: string;
  currentlyValid: boolean;
}

export async function permitsOf(ctx: AppContext, personId: string, holderName: string): Promise<PermitDto[]> {
  const rows = await q<any>(ctx.db, `SELECT p.*, t.name AS type_name, t.kind AS type_kind, t.status AS type_status, t.is_demo, t.map_group
    FROM permit p JOIN permit_type t ON t.id = p.permit_type_id WHERE p.person_id = $1 AND p.status <> 'entwurf' ORDER BY p.valid_to DESC`, [personId]);
  const today = zurichDate(ctx.now());
  return rows.map((r) => ({
    id: r.id, typeName: r.type_name, typeKind: r.type_kind, typeStatus: r.type_status, isDemo: r.is_demo, mapGroup: r.map_group,
    validFrom: r.valid_from, validTo: r.valid_to, status: r.status, paymentStatus: r.payment_status, source: r.source, externalRef: r.external_ref,
    credentialCode: r.credential_code,
    credentialToken: ctx.signer.sign({ v: 1, c: r.credential_code, n: holderName, t: r.type_name, g: r.map_group, f: r.valid_from, u: r.valid_to, i: ctx.now().toISOString(), ...(r.is_demo ? { d: 1 as const } : {}) }),
    currentlyValid: r.status === 'aktiv' && r.valid_from <= today && today <= r.valid_to,
  }));
}

/**
 * Kartengruppen, die eine Person sehen darf:
 *  - gültige Patente/Tageskarten → deren Karten,
 *  - Aufseher/Admin → alle Karten,
 *  - Mitglied ohne gültiges Patent → Karten zur Information (Hinweis in der App).
 *  - Gast → nur Karten seiner Tageskarten.
 */
export function allowedGroups(p: Principal, permits: PermitDto[]): { groups: MapGroup[]; reason: 'patent' | 'rolle' | 'info_ohne_patent' | 'keine' } {
  const fromPermits = [...new Set(permits.filter((x) => x.status === 'aktiv' && x.mapGroup && (x.currentlyValid || (p.kind === 'guest'))).map((x) => x.mapGroup!))];
  if (p.permissions.includes('maps.read_all_groups')) return { groups: ['aktive', 'jugend', 'tageskarte'], reason: 'rolle' };
  if (fromPermits.length) return { groups: fromPermits, reason: 'patent' };
  if (p.kind === 'member') return { groups: ['aktive', 'jugend', 'tageskarte'], reason: 'info_ohne_patent' };
  return { groups: [], reason: 'keine' };
}

export async function revokedCredentialCodes(db: Queryable) {
  const rows = await q<{ credential_code: string }>(db, `SELECT credential_code FROM permit WHERE status = 'gesperrt'`);
  return rows.map((r) => r.credential_code);
}
