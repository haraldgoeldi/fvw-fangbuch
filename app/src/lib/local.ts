import type { Catch, CatchDisposition, ControlRecord, IncidentReport, MapGroup, Tour, TourOutcome, ViolationReport } from '@fvw/shared';
import { getDb, getRecord, listRecords } from './db';
import { newId, saveWithOp } from './sync';

const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------- Touren & Fänge

export async function listTours(personId: string): Promise<Tour[]> {
  return (await listRecords<Tour>('tour', personId)).map((r) => ({ ...r.data, _sync: r.syncState, _msg: r.syncMessage }) as Tour & { _sync: string; _msg: string | null }).filter((t) => !t.deleted)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function listCatches(personId: string): Promise<(Catch & { _sync: string; _msg: string | null })[]> {
  return (await listRecords<Catch>('catch', personId)).map((r) => ({ ...r.data, _sync: r.syncState, _msg: r.syncMessage })).filter((c) => !c.deleted)
    .sort((a, b) => b.caughtAt.localeCompare(a.caughtAt));
}

export async function runningTour(personId: string): Promise<Tour | null> {
  const tours = await listTours(personId);
  return tours.find((t) => t.status === 'running') ?? null;
}

export async function startTour(personId: string, p: { waterKey: string; waterName: string; waterUnverified?: boolean; mapGroup: MapGroup | null; permitId: string | null }): Promise<Tour> {
  const t: Tour = { id: newId(), ...p, startedAt: nowIso(), endedAt: null, pauses: [], outcome: null, status: 'running', version: 0, updatedAt: nowIso() };
  await saveWithOp(personId, 'tour', t.id, toTourData(t));
  return t;
}

function toTourData(t: Tour, changeReason?: string): Record<string, unknown> {
  return { waterKey: t.waterKey, waterName: t.waterName, waterUnverified: !!t.waterUnverified, mapGroup: t.mapGroup, permitId: t.permitId, startedAt: t.startedAt,
    endedAt: t.endedAt, pauses: t.pauses, outcome: t.outcome, status: t.status, ...(changeReason ? { changeReason } : {}), id: t.id, version: t.version, updatedAt: nowIso() };
}

export async function updateTour(personId: string, t: Tour, changeReason?: string) {
  await saveWithOp(personId, 'tour', t.id, toTourData(t, changeReason));
}

export async function pauseTour(personId: string, t: Tour) {
  if (t.pauses.some((p) => p.end === null)) return;
  await updateTour(personId, { ...t, pauses: [...t.pauses, { start: nowIso(), end: null }] });
}

export async function resumeTour(personId: string, t: Tour) {
  await updateTour(personId, { ...t, pauses: t.pauses.map((p) => (p.end === null ? { ...p, end: nowIso() } : p)) });
}

export async function endTour(personId: string, t: Tour, outcome: TourOutcome) {
  const end = nowIso();
  await updateTour(personId, { ...t, endedAt: end, status: 'closed', outcome, pauses: t.pauses.map((p) => (p.end === null ? { ...p, end } : p)) });
}

export async function addCatch(personId: string, tourId: string, c: { species: string; lengthCm: number; disposition: CatchDisposition }) {
  const rec: Catch = { id: newId(), tourId, ...c, caughtAt: nowIso(), version: 0, updatedAt: nowIso() };
  await saveWithOp(personId, 'catch', rec.id, { ...rec });
  return rec;
}

export async function updateCatch(personId: string, c: Catch, changes: Partial<Catch>, changeReason?: string) {
  const next = { ...c, ...changes, updatedAt: nowIso() };
  delete (next as any)._sync; delete (next as any)._msg;
  await saveWithOp(personId, 'catch', c.id, { ...next, ...(changeReason ? { changeReason } : {}) });
}

export async function deleteCatch(personId: string, c: Catch, changeReason?: string) {
  const db = await getDb();
  await saveWithOp(personId, 'catch', c.id, { ...c, deleted: true, ...(changeReason ? { changeReason } : {}) }, 'delete', db);
}

// ---------------------------------------------------------------- Gewässervorschlag

export async function suggestWater(personId: string, name: string, mapGroup: MapGroup | null) {
  const id = newId();
  const waterKey = `vorschlag-${id.slice(0, 8)}`;
  await saveWithOp(personId, 'water_suggestion', id, { name: name.trim(), note: null, mapGroup, waterKey });
  return { waterKey, name: name.trim() };
}

// ---------------------------------------------------------------- Fotos (lokal speichern, später hochladen)

export async function storePhoto(personId: string, purpose: 'meldung' | 'kontrolle' | 'vergehen', uri: string, mime = 'image/jpeg'): Promise<string> {
  const id = newId();
  let finalUri = uri;
  try {
    const { Paths, Directory, File } = await import('expo-file-system');
    const dir = new Directory(Paths.document, 'photos');
    if (!dir.exists) dir.create();
    const src = new File(uri);
    const dest = new File(dir, `${id}.jpg`);
    src.copy(dest);
    finalUri = dest.uri;
  } catch {
    // Web: Daten-URI bzw. Blob-URL beibehalten
  }
  const db = await getDb();
  await db.runAsync('INSERT INTO photo(id, person_id, purpose, uri, mime, created_at) VALUES (?,?,?,?,?,?)', id, personId, purpose, finalUri, mime, nowIso());
  return id;
}

export async function photoUri(id: string): Promise<string | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ uri: string }>('SELECT uri FROM photo WHERE id=?', id);
  return r?.uri ?? null;
}

// ---------------------------------------------------------------- Meldungen, Kontrollen, Anmeldungen

export async function createReport(personId: string, r: Omit<IncidentReport, 'id' | 'createdAt' | 'version' | 'updatedAt'>) {
  const id = newId();
  await saveWithOp(personId, 'incident_report', id, { ...r, id, createdAt: nowIso() });
  return id;
}

export async function listReports(personId: string) {
  return listRecords<IncidentReport & { id: string }>('incident_report', personId);
}

export async function saveControl(personId: string, c: ControlRecord) {
  await saveWithOp(personId, 'control', c.id, { ...c, updatedAt: nowIso() });
}

export async function listControls(personId: string) {
  return listRecords<ControlRecord>('control', personId);
}

export async function saveViolation(personId: string, v: ViolationReport) {
  await saveWithOp(personId, 'violation', v.id, { ...v, updatedAt: nowIso() });
}

export async function registerForEvent(personId: string, eventId: string, eventTitle: string, participants: number, message: string | null) {
  const id = newId();
  await saveWithOp(personId, 'event_registration', id, { eventId, eventTitle, participants, message, createdAt: nowIso() });
  return id;
}

export async function listRegistrations(personId: string) {
  return listRecords<{ eventId: string; eventTitle: string; participants: number; createdAt: string }>('event_registration', personId);
}

export { getRecord };
