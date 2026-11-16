/**
 * Zeitzone Europe/Zurich ohne Abhängigkeit von Intl-Zeitzonendaten (Hermes/Android-sicher).
 * Sommerzeit (EU-Regel): letzter Sonntag im März 01:00 UTC bis letzter Sonntag im Oktober 01:00 UTC.
 */
function lastSundayUtc(year: number, month: number): number {
  const d = new Date(Date.UTC(year, month + 1, 0, 1, 0, 0)); // letzter Tag des Monats 01:00 UTC
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.getTime();
}

export function zurichOffsetMinutes(utcMs: number): number {
  const y = new Date(utcMs).getUTCFullYear();
  const start = lastSundayUtc(y, 2);
  const end = lastSundayUtc(y, 9);
  return utcMs >= start && utcMs < end ? 120 : 60;
}

export interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; second: number }

export function zurichParts(iso: string | Date): LocalParts {
  const ms = typeof iso === 'string' ? Date.parse(iso) : iso.getTime();
  const d = new Date(ms + zurichOffsetMinutes(ms) * 60_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds() };
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** «15.11.2026» */
export function formatDateCH(iso: string | Date): string {
  const p = zurichParts(iso);
  return `${p2(p.day)}.${p2(p.month)}.${p.year}`;
}

/** «14:05» */
export function formatTimeCH(iso: string | Date): string {
  const p = zurichParts(iso);
  return `${p2(p.hour)}:${p2(p.minute)}`;
}

export function formatDateTimeCH(iso: string | Date): string {
  return `${formatDateCH(iso)} ${formatTimeCH(iso)}`;
}

/** Lokales Kalenderdatum (YYYY-MM-DD) in Zürich. */
export function zurichDate(iso: string | Date): string {
  const p = zurichParts(iso);
  return `${p.year}-${p2(p.month)}-${p2(p.day)}`;
}

/** «1:05:09» bzw. «12:03» */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h > 0 ? `${h}:${p2(m)}:${p2(x)}` : `${p2(m)}:${p2(x)}`;
}
