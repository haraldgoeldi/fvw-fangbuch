import { type CatchDisposition } from './domain';
import { formatDateCH, formatTimeCH } from './time';

export const CATCH_CSV_COLUMNS = ['Datum', 'Uhrzeit', 'Mitglied', 'Gewässer', 'Art', 'Länge', 'Entnommen'] as const;

export interface CatchCsvRow {
  caughtAt: string;
  memberName: string;
  waterName: string;
  species: string;
  lengthCm: number;
  disposition: CatchDisposition;
}

/** Schutz vor Formel-Injektion in Tabellenprogrammen (=, +, -, @, Tab, CR am Zellanfang). */
export function csvCell(v: unknown, sep = ';'): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (s.includes('"') || s.includes(sep) || /[\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * CSV für Excel/Numbers/LibreOffice (Schweiz): UTF-8 mit BOM (Umlaute), Semikolon, CRLF.
 * Spalten gemäss Anforderung: Datum, Uhrzeit, Mitglied, Gewässer, Art, Länge, Entnommen.
 */
export function catchesToCsv(rows: CatchCsvRow[], opts: { separator?: ';' | ','; bom?: boolean } = {}): string {
  const sep = opts.separator ?? ';';
  const sorted = [...rows].sort((a, b) => a.caughtAt.localeCompare(b.caughtAt));
  const lines = [CATCH_CSV_COLUMNS.map((c) => csvCell(c, sep)).join(sep)];
  for (const r of sorted) {
    lines.push([
      formatDateCH(r.caughtAt),
      formatTimeCH(r.caughtAt),
      r.memberName,
      r.waterName,
      r.species,
      r.lengthCm,
      r.disposition === 'entnommen' ? 'ja' : 'nein',
    ].map((c) => csvCell(c, sep)).join(sep));
  }
  return (opts.bom === false ? '' : '﻿') + lines.join('\r\n') + '\r\n';
}

