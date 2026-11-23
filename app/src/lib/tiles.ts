import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import { API_URL } from './config';
import { bytesToBase64 } from './base64';
import { kvGet, kvSet } from './db';

/**
 * Offline-Kartenhintergrund: swisstopo LK25 (© Data: swisstopo) als MBTiles.
 *  - «basis» (Zoom 11–14) ist in der App enthalten → sofort offline verfügbar.
 *  - «detail» (bis Zoom 16, ca. 35 MB) kann bei Verbindung heruntergeladen werden.
 * Im Browser (nur Vorschau/Test) werden die Kacheln online vom Backend geladen.
 */
export interface TileSource {
  minZoom: number; maxZoom: number; label: string;
  /** Quellenangabe unten rechts auf der Karte (Pflicht bei swisstopo und Google). */
  attribution: string;
  /** Kacheln haben doppelte Auflösung (512 px) – keine feinere Zoomstufe nötig. */
  hiDpi?: boolean;
  get(z: number, x: number, y: number): Promise<string | null>;
}

/** Kartenhintergrund: Google (nur online) oder swisstopo (immer offline verfügbar). */
export type BasemapKind = 'google_roadmap' | 'google_satellite' | 'swisstopo';
export const BASEMAP_LABELS: Record<BasemapKind, string> = { google_roadmap: 'Google Karte', google_satellite: 'Google Satellit', swisstopo: 'swisstopo' };

const DETAIL_SHA_KEY = 'basemap:detail:sha256';
// Name mit Version: importDatabaseFromAssetAsync überschreibt eine vorhandene Datei nicht.
const BASIS_FILE = 'lk25-basis-v2.mbtiles';
const DETAIL_FILE = 'lk25-detail.mbtiles';
let basisDb: Promise<SQLite.SQLiteDatabase> | null = null;
let detailDb: Promise<SQLite.SQLiteDatabase | null> | null = null;
const cache = new Map<string, string | null>();

function remember(k: string, v: string | null) {
  cache.set(k, v);
  if (cache.size > 300) cache.delete(cache.keys().next().value as string);
}

async function openBasis() {
  if (!basisDb) {
    basisDb = (async () => {
      await SQLite.importDatabaseFromAssetAsync(BASIS_FILE, { assetId: require('../../assets/basemap/lk25-werdenberg-basis.mbtiles') });
      return SQLite.openDatabaseAsync(BASIS_FILE);
    })();
  }
  return basisDb;
}

async function openDetail() {
  if (!detailDb) {
    detailDb = (async () => {
      try {
        const { File, Directory } = await import('expo-file-system');
        const f = new File(new Directory(SQLite.defaultDatabaseDirectory), DETAIL_FILE);
        if (!f.exists) return null;
        return await SQLite.openDatabaseAsync(DETAIL_FILE);
      } catch {
        return null;
      }
    })();
  }
  return detailDb;
}

async function readTile(db: SQLite.SQLiteDatabase, z: number, x: number, y: number) {
  const row = await db.getFirstAsync<{ tile_data: Uint8Array }>('SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?', z, x, (1 << z) - 1 - y);
  return row ? `data:image/jpeg;base64,${bytesToBase64(new Uint8Array(row.tile_data))}` : null;
}

export async function tileSource(): Promise<TileSource> {
  if (Platform.OS === 'web') {
    return { minZoom: 11, maxZoom: 16, label: 'online (Browser-Vorschau)', attribution: '© Data: swisstopo', get: async (z, x, y) => `${API_URL}/api/basemap/${z > 14 ? 'detail' : 'basis'}/tiles/${z}/${x}/${y}.jpg` };
  }
  const detail = await openDetail();
  return {
    minZoom: 11, maxZoom: detail ? 16 : 14, attribution: '© Data: swisstopo', label: detail ? 'Offline-Paket Detail (Zoom 11–16)' : 'Offline-Paket Basis (Zoom 11–14)',
    get: async (z, x, y) => {
      const k = `${z}/${x}/${y}`;
      if (cache.has(k)) return cache.get(k)!;
      try {
        let uri: string | null = null;
        if (detail) uri = await readTile(detail, z, x, y);
        if (!uri && z <= 14) uri = await readTile(await openBasis(), z, x, y);
        remember(k, uri);
        return uri;
      } catch {
        return null;
      }
    },
  };
}

export async function detailPackageInstalled(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  return (await openDetail()) !== null;
}

async function serverDetailSha(): Promise<string | null> {
  try {
    const r = await fetch(`${API_URL}/api/basemap/detail/manifest`);
    return r.ok ? ((await r.json()).sha256 ?? null) : null;
  } catch {
    return null;
  }
}

/** Gibt es auf dem Server eine neuere (z. B. schärfere) Detailkarte als die gespeicherte? */
export async function detailUpdateAvailable(): Promise<boolean> {
  if (Platform.OS === 'web' || !(await detailPackageInstalled())) return false;
  const server = await serverDetailSha();
  return !!server && server !== (await kvGet<string>(DETAIL_SHA_KEY));
}

/** Detail-Kartenpaket herunterladen bzw. ersetzen (WLAN empfohlen, ca. 35 MB). */
export async function downloadDetailPackage(): Promise<void> {
  const { File, Directory } = await import('expo-file-system');
  const sha = await serverDetailSha();
  const dir = new Directory(SQLite.defaultDatabaseDirectory);
  if (!dir.exists) dir.create();
  const old = detailDb ? await detailDb : null;
  detailDb = null;
  cache.clear();
  if (old) await old.closeAsync().catch(() => undefined);
  const target = new File(dir, DETAIL_FILE);
  if (target.exists) target.delete();
  await File.downloadFileAsync(`${API_URL}/api/basemap/detail/file${sha ? `?v=${sha.slice(0, 12)}` : ''}`, target, { idempotent: true });
  if (sha) await kvSet(DETAIL_SHA_KEY, sha);
  detailDb = null;
  cache.clear();
}

// ---------------------------------------------------------------- Google Map Tiles API
// https://developers.google.com/maps/documentation/tile/2d-tiles-overview
// Kacheln werden nur online geladen und nicht dauerhaft gespeichert (Google-Nutzungsbedingungen).
const GOOGLE = 'https://tile.googleapis.com';
const googleSessions = new Map<string, Promise<TileSource>>();

async function createGoogleSource(key: string, mapType: 'roadmap' | 'satellite'): Promise<TileSource> {
  const r = await fetch(`${GOOGLE}/v1/createSession?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mapType, language: 'de-CH', region: 'CH', scale: 'scaleFactor2x', highDpi: true }),
  });
  if (!r.ok) throw new Error(`Google-Karte nicht verfügbar (${r.status})`);
  const { session } = await r.json() as { session: string };
  const q = `session=${encodeURIComponent(session)}&key=${encodeURIComponent(key)}`;
  let copyright = '';
  try {
    // Quellenangabe für das Vereinsgebiet (Pflicht laut Google)
    const v = await fetch(`${GOOGLE}/tile/v1/viewport?${q}&zoom=13&north=47.29&south=47.08&east=9.56&west=9.36`);
    if (v.ok) copyright = ((await v.json()) as { copyright?: string }).copyright ?? '';
  } catch { /* Quellenangabe optional nachladen */ }
  return {
    minZoom: 0, maxZoom: 20, hiDpi: true,
    label: mapType === 'satellite' ? 'Google Satellit' : 'Google Karte',
    attribution: `Google${copyright ? ` · ${copyright}` : ''}`,
    get: async (z, x, y) => `${GOOGLE}/v1/2dtiles/${z}/${x}/${y}?${q}`,
  };
}

/** Kachelquelle für den gewählten Hintergrund; ohne Netz oder Schlüssel immer swisstopo. */
export async function basemapSource(kind: BasemapKind, googleKey: string | null | undefined, online: boolean): Promise<TileSource> {
  if (kind === 'swisstopo' || !googleKey || !online) return tileSource();
  const mapType = kind === 'google_satellite' ? 'satellite' : 'roadmap';
  const k = `${googleKey}|${mapType}`;
  if (!googleSessions.has(k)) googleSessions.set(k, createGoogleSource(googleKey, mapType));
  try {
    return await googleSessions.get(k)!;
  } catch {
    googleSessions.delete(k);
    return tileSource();
  }
}
