/**
 * Datensätze, die offline auf dem Gerät entstehen und synchronisiert werden, sowie das Sync-Protokoll.
 * IDs werden auf dem Gerät als UUID erzeugt → Wiederholungsversuche erzeugen keine Duplikate.
 */
import { LENGTH_CM_MAX, LENGTH_CM_MIN, type CatchDisposition, type MapGroup, type TourOutcome } from './domain';

export interface TourPause { start: string; end: string | null }

export interface Tour {
  id: string;
  waterKey: string;
  waterName: string;
  /** true, wenn das Gewässer von der Person neu erfasst wurde (ungeprüft). */
  waterUnverified?: boolean;
  mapGroup: MapGroup | null;
  permitId: string | null;
  startedAt: string;
  endedAt: string | null;
  pauses: TourPause[];
  outcome: TourOutcome | null;
  status: 'running' | 'closed';
  /** Kontrolle durch Aufseher (Vermerk), sofern vorhanden. */
  controlIds?: string[];
  version: number;
  updatedAt: string;
  deleted?: boolean;
}

export interface Catch {
  id: string;
  tourId: string;
  species: string;
  lengthCm: number;
  disposition: CatchDisposition;
  caughtAt: string;
  version: number;
  updatedAt: string;
  deleted?: boolean;
  /** Pflicht, wenn ein Fang nach Abschluss der Tour geändert wird (Protokoll). */
  changeReason?: string | null;
}

export interface WaterSuggestion {
  id: string;
  name: string;
  note: string | null;
  mapGroup: MapGroup | null;
  createdAt: string;
  status: 'ungeprueft' | 'bestaetigt' | 'abgelehnt';
  version: number;
  updatedAt: string;
}

export interface IncidentReport {
  id: string;
  kind: 'verschmutzung' | 'tote_fische' | 'andere';
  description: string;
  waterKey: string | null;
  waterName: string | null;
  /** Nur mit ausdrücklicher Einwilligung. */
  location: { lat: number; lon: number; accuracyM: number | null } | null;
  photoIds: string[];
  observedAt: string;
  createdAt: string;
  version: number;
  updatedAt: string;
}

export interface ControlRecord {
  id: string;
  startedAt: string;
  endedAt: string | null;
  waterKey: string | null;
  waterName: string | null;
  /** Gescannter Ausweis (Patent/Tageskarte) – nur die Ausweis-Prüfnummer, keine weiteren Personendaten. */
  checkedCredentialCode: string | null;
  credentialResult: 'gueltig' | 'ungueltig' | 'abgelaufen' | 'nicht_geprueft' | 'manuell' | null;
  checkedPersonLabel: string | null;
  tourId: string | null;
  notes: string | null;
  photoIds: string[];
  confirmation: { method: 'none' | 'pin' | 'signature' | 'qr'; value: string | null; at: string | null } | null;
  status: 'offen' | 'abgeschlossen';
  version: number;
  updatedAt: string;
}

export interface ViolationReport {
  id: string;
  controlId: string | null;
  firstName: string | null;
  lastName: string | null;
  description: string;
  photoIds: string[];
  createdAt: string;
  version: number;
  updatedAt: string;
}

export interface EventRegistration {
  id: string;
  eventId: string;
  eventTitle: string;
  participants: number;
  message: string | null;
  createdAt: string;
  version: number;
  updatedAt: string;
}

export type SyncEntity = 'tour' | 'catch' | 'water_suggestion' | 'incident_report' | 'control' | 'violation' | 'event_registration';

export interface SyncOp {
  /** Idempotenzschlüssel (UUID). Dieselbe Operation wird nur einmal angewendet. */
  opId: string;
  entity: SyncEntity;
  entityId: string;
  op: 'upsert' | 'delete';
  /** Version, auf der die Änderung beruht (null = neu bzw. unbekannt). */
  baseVersion: number | null;
  /** Vorherige, noch nicht bestätigte Operation desselben Datensatzes (Kausalkette im Offline-Puffer). */
  prevOpId?: string | null;
  data: Record<string, unknown>;
  clientTime: string;
}

export interface SyncOpResult {
  opId: string;
  entityId: string;
  status: 'applied' | 'duplicate' | 'conflict' | 'rejected';
  version?: number;
  message?: string;
  conflictId?: string;
}

export interface PushRequest { deviceId: string; ops: SyncOp[] }
export interface PushResponse { serverTime: string; results: SyncOpResult[] }

// ---------- Validierung (App und Backend identisch) ----------

export interface ValidationError { field: string; message: string }

export function validateLength(v: unknown): ValidationError | null {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return { field: 'lengthCm', message: 'Bitte die Länge in cm eingeben.' };
  if (!Number.isInteger(n)) return { field: 'lengthCm', message: 'Bitte die Länge in ganzen Zentimetern eingeben.' };
  if (n < LENGTH_CM_MIN || n > LENGTH_CM_MAX) return { field: 'lengthCm', message: `Die Länge muss zwischen ${LENGTH_CM_MIN} und ${LENGTH_CM_MAX} cm liegen (technische Plausibilitätsprüfung, kein Mindestmass).` };
  return null;
}

export function validateCatch(c: Partial<Catch>, tour: Pick<Tour, 'status' | 'startedAt' | 'endedAt'> | null, species: readonly string[], opts: { editingClosedTour?: boolean } = {}): ValidationError[] {
  const errs: ValidationError[] = [];
  if (!tour) errs.push({ field: 'tourId', message: 'Ein Fang kann nur zu einer Tour erfasst werden.' });
  else if (tour.status !== 'running' && !opts.editingClosedTour) errs.push({ field: 'tourId', message: 'Fänge können nur während einer laufenden Tour erfasst werden.' });
  if (!c.species || !species.includes(c.species)) errs.push({ field: 'species', message: 'Bitte die Fischart wählen.' });
  const le = validateLength(c.lengthCm);
  if (le) errs.push(le);
  if (c.disposition !== 'entnommen' && c.disposition !== 'zurueckgesetzt') errs.push({ field: 'disposition', message: 'Bitte wählen: entnommen oder zurückgesetzt.' });
  if (!c.caughtAt || Number.isNaN(Date.parse(c.caughtAt))) errs.push({ field: 'caughtAt', message: 'Zeitpunkt fehlt.' });
  if (opts.editingClosedTour && !c.changeReason?.trim()) errs.push({ field: 'changeReason', message: 'Bitte einen Grund für die Änderung angeben (die Tour ist abgeschlossen).' });
  return errs;
}

export function validateTour(t: Partial<Tour>): ValidationError[] {
  const errs: ValidationError[] = [];
  if (!t.waterKey || !t.waterName?.trim()) errs.push({ field: 'waterKey', message: 'Bitte ein Gewässer wählen.' });
  if (!t.startedAt || Number.isNaN(Date.parse(t.startedAt))) errs.push({ field: 'startedAt', message: 'Startzeit fehlt.' });
  if (t.endedAt && t.startedAt && Date.parse(t.endedAt) < Date.parse(t.startedAt)) errs.push({ field: 'endedAt', message: 'Ende liegt vor dem Start.' });
  if (t.status === 'closed' && !t.endedAt) errs.push({ field: 'endedAt', message: 'Abgeschlossene Tour ohne Ende.' });
  if (t.status === 'closed' && t.outcome !== 'catch' && t.outcome !== 'null_report') errs.push({ field: 'outcome', message: 'Bitte Fangmeldung oder Nullmeldung wählen.' });
  return errs;
}

/** Fischzeit ohne Pausen (Sekunden). */
export function tourDurationSec(t: Pick<Tour, 'startedAt' | 'endedAt' | 'pauses'>, now: Date = new Date()): number {
  const end = t.endedAt ? Date.parse(t.endedAt) : now.getTime();
  let total = end - Date.parse(t.startedAt);
  for (const p of t.pauses ?? []) {
    const ps = Date.parse(p.start);
    const pe = p.end ? Date.parse(p.end) : end;
    total -= Math.max(0, Math.min(pe, end) - ps);
  }
  return Math.max(0, Math.round(total / 1000));
}

export function isPaused(t: Pick<Tour, 'pauses' | 'status'>): boolean {
  return t.status === 'running' && (t.pauses ?? []).some((p) => p.end === null);
}

/** UUID v4 (crypto.getRandomValues, falls vorhanden). */
export function uuid(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
