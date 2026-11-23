import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import { secureGet, secureSet } from './secure';

/**
 * Lokale Datenbank (SQLite). Jede Eingabe wird sofort und transaktional gespeichert (WAL, synchronous=FULL),
 * damit Absturz, erzwungenes Beenden oder leerer Akku keine Daten kosten.
 * Verschlüsselung: SQLCipher (Config-Plugin expo-sqlite useSQLCipher) mit Schlüssel im Keychain/Keystore.
 * In Expo Go und im Browser ist SQLCipher nicht verfügbar – das wird in der App angezeigt.
 */
export type DB = SQLite.SQLiteDatabase;
let dbPromise: Promise<DB> | null = null;
export const encryption = { active: false, detail: 'unbekannt' };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS record (
  entity TEXT NOT NULL, id TEXT NOT NULL, person_id TEXT NOT NULL, data TEXT NOT NULL,
  server_version INTEGER, sync_state TEXT NOT NULL DEFAULT 'pending', sync_message TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY (entity, id));
CREATE INDEX IF NOT EXISTS record_person ON record(person_id, entity);
CREATE TABLE IF NOT EXISTS outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT UNIQUE NOT NULL, person_id TEXT NOT NULL, entity TEXT NOT NULL,
  entity_id TEXT NOT NULL, op TEXT NOT NULL, base_version INTEGER, prev_op_id TEXT, data TEXT NOT NULL, client_time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, result TEXT, created_at TEXT NOT NULL, sent_at TEXT);
CREATE INDEX IF NOT EXISTS outbox_status ON outbox(person_id, status, seq);
CREATE TABLE IF NOT EXISTS photo (
  id TEXT PRIMARY KEY, person_id TEXT NOT NULL, purpose TEXT NOT NULL, uri TEXT NOT NULL, mime TEXT NOT NULL,
  uploaded INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS map_bundle (grp TEXT PRIMARY KEY, etag TEXT, data TEXT NOT NULL, fetched_at TEXT NOT NULL, activated_at TEXT);
`;

async function dbKey(): Promise<string> {
  let k = await secureGet('db_key');
  if (!k) {
    const bytes = Crypto.getRandomBytes(32);
    k = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    await secureSet('db_key', k);
  }
  return k;
}

async function openWithRetry(): Promise<DB> {
  // Im Browser hält eine eben geschlossene Seite die Datei (OPFS) evtl. noch kurz gesperrt → erneut versuchen.
  let last: unknown;
  for (let i = 0; i < 12; i++) {
    try {
      return await SQLite.openDatabaseAsync('fangbuch.db');
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 250 * Math.min(8, i + 1)));
    }
  }
  throw last;
}

/**
 * Die Browser-Vorschau speichert in OPFS. Das gibt es nur in einem «sicheren Kontext» (https oder localhost).
 * Ruft man die Vorschau auf dem Handy über http://<PC-IP>:8790 auf, scheitert expo-sqlite mit «Invalid VFS state».
 */
function webStorageProblem(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const hasOpfs = typeof navigator !== 'undefined' && !!(navigator as any).storage?.getDirectory;
  if (window.isSecureContext && hasOpfs) return null;
  return 'Die Browser-Vorschau funktioniert nur auf dem PC selbst (http://localhost:8790). Auf dem Handy die App bitte mit Expo Go öffnen (Docker-Anleitung, Kapitel 8).';
}

async function open(): Promise<DB> {
  const problem = webStorageProblem();
  if (problem) throw new Error(problem);
  const db = await openWithRetry();
  if (Platform.OS !== 'web') {
    const key = await dbKey();
    await db.execAsync(`PRAGMA key = "x'${key}'";`);
    try {
      const r = await db.getFirstAsync<{ cipher_version?: string }>('PRAGMA cipher_version;');
      encryption.active = !!r?.cipher_version;
      encryption.detail = r?.cipher_version ? `SQLCipher ${r.cipher_version}` : 'nicht verfügbar (z. B. Expo Go) – im Release-Build aktiv';
    } catch {
      encryption.detail = 'nicht verfügbar';
    }
    await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
  } else {
    encryption.detail = 'Browser-Vorschau: keine Verschlüsselung';
  }
  await db.execAsync(SCHEMA);
  return db;
}

export function getDb(): Promise<DB> {
  if (!dbPromise) dbPromise = open().catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
}

const nowIso = () => new Date().toISOString();

export async function kvGet<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  return r ? (JSON.parse(r.value) as T) : null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT INTO kv(key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at', key, JSON.stringify(value), nowIso());
}

export async function kvDelete(key: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM kv WHERE key = ?', key);
}

export interface StoredRecord<T> { entity: string; id: string; personId: string; data: T; serverVersion: number | null; syncState: string; syncMessage: string | null; updatedAt: string }

function rowToRecord<T>(r: any): StoredRecord<T> {
  return { entity: r.entity, id: r.id, personId: r.person_id, data: JSON.parse(r.data), serverVersion: r.server_version, syncState: r.sync_state, syncMessage: r.sync_message, updatedAt: r.updated_at };
}

export async function listRecords<T>(entity: string, personId: string): Promise<StoredRecord<T>[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>('SELECT * FROM record WHERE entity = ? AND person_id = ? ORDER BY updated_at DESC', entity, personId);
  return rows.map((r) => rowToRecord<T>(r));
}

export async function getRecord<T>(entity: string, id: string): Promise<StoredRecord<T> | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<any>('SELECT * FROM record WHERE entity = ? AND id = ?', entity, id);
  return r ? rowToRecord<T>(r) : null;
}

export async function wipeLocalData(): Promise<void> {
  const db = await getDb();
  await db.execAsync('DELETE FROM record; DELETE FROM outbox; DELETE FROM photo; DELETE FROM map_bundle; DELETE FROM kv;');
}

/**
 * Transaktion: nativ exklusiv (keine Verschränkung paralleler Abfragen), im Browser
 * (expo-sqlite Web unterstützt keine exklusiven Transaktionen) als normale Transaktion.
 */
let txChain: Promise<unknown> = Promise.resolve();
export async function inTx(db: DB, fn: (t: Pick<DB, "runAsync" | "getFirstAsync" | "getAllAsync" | "execAsync">) => Promise<void>): Promise<void> {
  // App-weite Sperre: Transaktionen laufen nacheinander (z. B. «Fang speichern» während der Synchronisation).
  const run = () => (Platform.OS === 'web' ? db.withTransactionAsync(() => fn(db)) : db.withExclusiveTransactionAsync((txn) => fn(txn)));
  const next = txChain.then(run, run);
  txChain = next.catch(() => undefined);
  return next;
}
