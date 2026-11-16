import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import type { Config } from '../config';
import { fetchWithTimeout } from './status';

/** Liest eine KMZ (ZIP) oder KML und liefert den KML-Text des Hauptdokuments. */
export async function kmlFromBuffer(buf: Buffer): Promise<{ kml: string; format: 'kml' | 'kmz' }> {
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files).filter((n) => n.toLowerCase().endsWith('.kml'));
    const main = names.find((n) => n.toLowerCase() === 'doc.kml') ?? names[0];
    if (!main) throw new Error('KMZ enthält keine KML-Datei');
    return { kml: await zip.file(main)!.async('string'), format: 'kmz' };
  }
  return { kml: buf.toString('utf8'), format: 'kml' };
}

export interface MyMapsFetcher {
  readonly mode: 'live' | 'file' | 'off';
  describe(): { configured: boolean; detail: string };
  /** Holt den aktuellen Stand einer My-Maps-Karte über den Netzwerklink. */
  fetch(myMapsId: string): Promise<Buffer>;
}

/**
 * Der Abruf erfolgt ausschliesslich im Backend. Voraussetzung: Karte ist «Jeder mit dem Link» freigegeben.
 * Antwort ist eine KMZ (application/vnd.google-earth.kmz).
 */
class LiveMyMaps implements MyMapsFetcher {
  readonly mode = 'live' as const;
  describe() { return { configured: true, detail: 'Abruf über www.google.com/maps/d/kml?mid=… (täglich)' }; }
  async fetch(id: string) {
    const res = await fetchWithTimeout(`https://www.google.com/maps/d/kml?mid=${encodeURIComponent(id)}`, { timeoutMs: 60_000, redirect: 'follow' });
    if (res.status === 403 || res.status === 401) throw new Error(`Karte ${id} ist nicht freigegeben (HTTP ${res.status}). My-Maps-Freigabe «Jeder mit dem Link» prüfen.`);
    if (!res.ok) throw new Error(`My Maps antwortet mit HTTP ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (type.includes('text/html')) throw new Error('My Maps lieferte eine HTML-Seite statt KMZ (Freigabe oder Anmeldung erforderlich?)');
    return buf;
  }
}

/** Testmodus: liest «<mid>.kml|.kmz» aus einem Verzeichnis (für Tests und Offline-Entwicklung). */
class FileMyMaps implements MyMapsFetcher {
  readonly mode = 'file' as const;
  constructor(private dir: string) {}
  describe() { return { configured: true, detail: `Testmodus: Dateien aus ${this.dir}` }; }
  async fetch(id: string) {
    for (const ext of ['.kmz', '.kml']) {
      try { return await readFile(join(this.dir, id + ext)); } catch { /* weiter */ }
    }
    throw new Error(`Keine Testdatei für ${id} in ${this.dir}`);
  }
}

class OffMyMaps implements MyMapsFetcher {
  readonly mode = 'off' as const;
  describe() { return { configured: false, detail: 'Automatische Aktualitätsprüfung deaktiviert (MYMAPS_MODE=off) – manueller Import möglich' }; }
  async fetch(): Promise<Buffer> { throw new Error('Aktualitätsprüfung deaktiviert'); }
}

export function createMyMapsFetcher(cfg: Config): MyMapsFetcher {
  if (cfg.MYMAPS_MODE === 'file' && cfg.MYMAPS_FILE_DIR) return new FileMyMaps(cfg.MYMAPS_FILE_DIR);
  if (cfg.MYMAPS_MODE === 'live') return new LiveMyMaps();
  return new OffMyMaps();
}
