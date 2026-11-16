import { q, type Queryable } from './db';

export interface Actor { personId: string | null; label: string }
export const SYSTEM: Actor = { personId: null, label: 'System' };

/** Protokolliert wichtige Adminaktionen, Importe, Regel- und Berechtigungsänderungen (PA §14). */
export async function audit(db: Queryable, actor: Actor, action: string, entity: string | null, entityId: string | null, details: unknown = null) {
  await q(db, 'INSERT INTO audit_log(actor_person_id, actor_label, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6)',
    [actor.personId, actor.label, action, entity, entityId, details === null ? null : JSON.stringify(details)]);
}
