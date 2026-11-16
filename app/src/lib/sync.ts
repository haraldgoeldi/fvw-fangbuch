import type { SyncEntity, SyncOpResult } from '@fvw/shared';
import { Platform } from 'react-native';
import { apiFetch, ApiError } from './api';
import { getDb, inTx, kvGet, kvSet, type DB } from './db';

/**
 * Outbox-Synchronisation:
 *  - Jede Änderung wird zusammen mit einer Operation (UUID = Idempotenzschlüssel) in derselben
 *    Transaktion gespeichert. Wiederholte Übertragung erzeugt serverseitig keine Duplikate.
 *  - Operationen desselben Datensatzes bilden eine Kette (prevOpId), damit der Server Offline-Abfolgen
 *    nicht als Konflikt wertet.
 *  - Abgelehnte oder konfliktbehaftete Operationen bleiben sichtbar gespeichert – nichts wird verworfen.
 */
const nowIso = () => new Date().toISOString();

export function newId(): string {
  const c: any = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  // expo-crypto als Rückfall
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('expo-crypto').randomUUID();
}

export async function saveWithOp(personId: string, entity: SyncEntity, id: string, data: Record<string, unknown>, op: 'upsert' | 'delete' = 'upsert', db?: DB) {
  const d = db ?? (await getDb());
  await inTx(d, async (txn) => {
    const existing = await txn.getFirstAsync<{ server_version: number | null }>('SELECT server_version FROM record WHERE entity=? AND id=?', entity, id);
    const prev = await txn.getFirstAsync<{ op_id: string }>(`SELECT op_id FROM outbox WHERE entity=? AND entity_id=? AND status IN ('pending','sending') ORDER BY seq DESC LIMIT 1`, entity, id);
    await txn.runAsync(`INSERT INTO record(entity, id, person_id, data, server_version, sync_state, updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(entity, id) DO UPDATE SET data=excluded.data, sync_state='pending', sync_message=NULL, updated_at=excluded.updated_at`,
      entity, id, personId, JSON.stringify(data), existing?.server_version ?? null, 'pending', nowIso());
    await txn.runAsync(`INSERT INTO outbox(op_id, person_id, entity, entity_id, op, base_version, prev_op_id, data, client_time, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      newId(), personId, entity, id, op, existing?.server_version ?? null, prev?.op_id ?? null, JSON.stringify(data), nowIso(), nowIso());
  });
}

export async function pendingCount(personId: string): Promise<number> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM outbox WHERE person_id=? AND status IN ('pending','sending')`, personId);
  const p = await db.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM photo WHERE person_id=? AND uploaded=0`, personId);
  return (r?.n ?? 0) + (p?.n ?? 0);
}

export async function problemOps(personId: string) {
  const db = await getDb();
  return db.getAllAsync<any>(`SELECT * FROM outbox WHERE person_id=? AND status IN ('rejected','conflict') ORDER BY seq DESC LIMIT 50`, personId);
}

/** Ops anderer Konten (z. B. nach Kontowechsel auf dem Gerät) – werden nicht unter fremdem Namen übertragen. */
export async function foreignPending(personId: string) {
  const db = await getDb();
  const r = await db.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM outbox WHERE person_id<>? AND status IN ('pending','sending')`, personId);
  return r?.n ?? 0;
}

export async function retryOp(opId: string) {
  const db = await getDb();
  await db.runAsync(`UPDATE outbox SET status='pending', attempts=0, last_error=NULL WHERE op_id=? AND status IN ('rejected')`, opId);
}

export interface SyncSummary { ok: boolean; pushed: number; rejected: number; conflicts: number; photos: number; message?: string; authError?: boolean }

async function uploadPhotos(token: string, personId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(`SELECT * FROM photo WHERE person_id=? AND uploaded=0 ORDER BY created_at LIMIT 10`, personId);
  let n = 0;
  for (const p of rows) {
    const form = new FormData();
    form.append('id', p.id);
    form.append('purpose', p.purpose);
    if (Platform.OS === 'web') {
      const blob = await (await fetch(p.uri)).blob();
      form.append('file', new File([blob], `${p.id}.jpg`, { type: p.mime }));
    } else {
      form.append('file', { uri: p.uri, name: `${p.id}.jpg`, type: p.mime } as any);
    }
    try {
      await apiFetch('/app/photos', { body: form, token, timeoutMs: 60_000 });
      await db.runAsync('UPDATE photo SET uploaded=1, last_error=NULL WHERE id=?', p.id);
      n++;
    } catch (e: any) {
      await db.runAsync('UPDATE photo SET attempts=attempts+1, last_error=? WHERE id=?', String(e?.message ?? e), p.id);
      if (e instanceof ApiError && e.status === 0) throw e;
    }
  }
  return n;
}

let running: Promise<SyncSummary> | null = null;

/** Überträgt ausstehende Operationen und holt den Serverstand. Läuft nie parallel. */
export function syncNow(token: string, personId: string, deviceId: string): Promise<SyncSummary> {
  if (!running) running = doSync(token, personId, deviceId).finally(() => { running = null; });
  return running;
}

async function doSync(token: string, personId: string, deviceId: string): Promise<SyncSummary> {
  const db = await getDb();
  const sum: SyncSummary = { ok: true, pushed: 0, rejected: 0, conflicts: 0, photos: 0 };
  try {
    sum.photos = await uploadPhotos(token, personId);
    for (let round = 0; round < 20; round++) {
      const ops = await db.getAllAsync<any>(`SELECT * FROM outbox WHERE person_id=? AND status IN ('pending','sending') ORDER BY seq LIMIT 100`, personId);
      if (!ops.length) break;
      await db.runAsync(`UPDATE outbox SET status='sending', sent_at=? WHERE seq IN (${ops.map(() => '?').join(',')})`, nowIso(), ...ops.map((o) => o.seq));
      let res: { results: SyncOpResult[] };
      try {
        res = await apiFetch('/app/sync/push', {
          token, timeoutMs: 45_000,
          body: { deviceId, ops: ops.map((o) => ({ opId: o.op_id, entity: o.entity, entityId: o.entity_id, op: o.op, baseVersion: o.base_version, prevOpId: o.prev_op_id, data: JSON.parse(o.data), clientTime: o.client_time })) },
        });
      } catch (e) {
        // Antwort unbekannt → später mit denselben opIds erneut senden (idempotent)
        await db.runAsync(`UPDATE outbox SET status='pending', attempts=attempts+1, last_error=? WHERE status='sending' AND person_id=?`, String((e as Error).message), personId);
        throw e;
      }
      await inTx(db, async (txn) => {
        for (const r of res.results) {
          const o = ops.find((x) => x.op_id === r.opId)!;
          const status = r.status === 'applied' || r.status === 'duplicate' ? 'done' : r.status;
          await txn.runAsync(`UPDATE outbox SET status=?, result=?, last_error=? WHERE op_id=?`, status, JSON.stringify(r), r.message ?? null, r.opId);
          if (status === 'done') {
            sum.pushed++;
            const stillPending = await txn.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM outbox WHERE entity=? AND entity_id=? AND status IN ('pending','sending')`, o.entity, o.entity_id);
            await txn.runAsync(`UPDATE record SET server_version=COALESCE(?, server_version), sync_state=?, sync_message=NULL WHERE entity=? AND id=?`,
              r.version ?? null, stillPending?.n ? 'pending' : 'synced', o.entity, o.entity_id);
          } else {
            if (status === 'rejected') sum.rejected++; else sum.conflicts++;
            await txn.runAsync(`UPDATE record SET sync_state=?, sync_message=? WHERE entity=? AND id=?`, status, r.message ?? null, o.entity, o.entity_id);
          }
        }
      });
    }
    await pull(token, personId);
    await kvSet(`last_sync:${personId}`, nowIso());
  } catch (e) {
    sum.ok = false;
    sum.message = e instanceof ApiError ? e.message : String((e as Error)?.message ?? e);
    sum.authError = e instanceof ApiError && (e.status === 401 || e.status === 403);
  }
  await kvSet(`last_sync_result:${personId}`, { ...sum, at: nowIso() });
  return sum;
}

/** Eigene Datensätze vom Server übernehmen, sofern lokal nichts aussteht (Mehrgeräte-Abgleich). */
async function pull(token: string, personId: string) {
  const db = await getDb();
  const since = await kvGet<string>(`last_pull:${personId}`);
  const res = await apiFetch(`/app/sync/pull${since ? `?since=${encodeURIComponent(since)}` : ''}`, { token });
  await inTx(db, async (txn) => {
    const upsert = async (entity: string, rec: any) => {
      const pending = await txn.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM outbox WHERE entity=? AND entity_id=? AND status IN ('pending','sending','rejected','conflict')`, entity, rec.id);
      if (pending?.n) return;
      if (rec.deleted) { await txn.runAsync('DELETE FROM record WHERE entity=? AND id=?', entity, rec.id); return; }
      await txn.runAsync(`INSERT INTO record(entity, id, person_id, data, server_version, sync_state, updated_at) VALUES (?,?,?,?,?, 'synced', ?)
        ON CONFLICT(entity, id) DO UPDATE SET data=excluded.data, server_version=excluded.server_version, sync_state='synced', sync_message=NULL, updated_at=excluded.updated_at`,
        entity, rec.id, personId, JSON.stringify(rec), rec.version, rec.updatedAt ?? nowIso());
    };
    for (const t of res.tours) await upsert('tour', t);
    for (const c of res.catches) await upsert('catch', c);
  });
  await kvSet(`delivery:${personId}`, { reports: res.reports, registrations: res.registrations, waterSuggestions: res.waterSuggestions, conflicts: res.conflicts });
  await kvSet(`last_pull:${personId}`, res.serverTime);
}
