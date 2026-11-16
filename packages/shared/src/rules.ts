import type { MapGroup } from './domain';
import { bboxNear, distanceToGeometryMeters } from './geo';
import type { Section } from './kml/import';
import type { Position } from './kml/parse';

/**
 * Strukturierte Sperrzeit (PA §7). Wird ausschliesslich vom Admin erfasst; Freitexte aus den
 * Kartendaten werden NIE automatisch hierher übernommen.
 */
export interface Closure {
  id: string;
  /** Gewässer (alle Abschnitte) oder einzelne Abschnitte. */
  waterKey: string | null;
  sectionIds: string[];
  /** null = alle Kartengruppen. */
  groups: MapGroup[] | null;
  /** ISO-Datum YYYY-MM-DD (inklusive). */
  from: string;
  /** ISO-Datum YYYY-MM-DD (inklusive). */
  to: string;
  reason: string;
  status: 'active' | 'draft' | 'revoked';
}

/** Aktuelle Zustandsmeldung zu einem Gewässer (News-Kategorie «Gewässerzustand»). */
export interface WaterCondition {
  newsId: string;
  waterKey: string;
  title: string;
  publishedAt: string;
  expiresAt: string | null;
  waterLevel?: string | null;
  turbidity?: string | null;
  ice?: string | null;
  closureNote?: string | null;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function closuresFor(section: Pick<Section, 'id' | 'waterKey' | 'group'>, closures: Closure[], date: string): Closure[] {
  return closures.filter((c) =>
    c.status === 'active' && c.from <= date && date <= c.to &&
    (c.groups === null || c.groups.includes(section.group)) &&
    (c.sectionIds.includes(section.id) || (c.waterKey !== null && c.sectionIds.length === 0 && c.waterKey === section.waterKey)));
}

export function conditionIsCurrent(c: WaterCondition, now: Date): boolean {
  return !c.expiresAt || new Date(c.expiresAt).getTime() > now.getTime();
}

export type PositionLevel = 'ok' | 'closed' | 'unclear' | 'outside' | 'no_data';

export interface PositionAssessment {
  level: PositionLevel;
  toleranceM: number;
  accuracyM: number | null;
  nearest: { sectionId: string; name: string; distanceM: number; closed: boolean; fishingAllowed: boolean | null; ruleLabel: string }[];
  message: string;
  disclaimer: string;
}

export const GPS_DISCLAIMER = 'GPS ist nur eine ungefähre Orientierung und kein verbindlicher Rechtsnachweis. Massgebend sind die Vorschriften des Vereins und die Beschilderung vor Ort.';

/**
 * Lagebeurteilung für Hinweise in der App (PA §7).
 * toleranceM ist ein technischer Parameter (Linien sind Gewässerachsen; man steht am Ufer) – keine Vereinsregel.
 */
export function assessPosition(
  pt: Position,
  accuracyM: number | null,
  sections: Section[],
  opts: { toleranceM: number; maxToleranceM?: number; date: string; closures?: Closure[] },
): PositionAssessment {
  const tol = Math.min(Math.max(opts.toleranceM, accuracyM ?? 0), opts.maxToleranceM ?? 300);
  const waters = sections.filter((s) => s.kind === 'water');
  if (waters.length === 0) {
    return { level: 'no_data', toleranceM: tol, accuracyM, nearest: [], message: 'Für diese Karte sind keine Gewässerdaten geladen.', disclaimer: GPS_DISCLAIMER };
  }
  const scored: { s: Section; d: number; closed: boolean }[] = [];
  for (const s of waters) {
    if (!bboxNear(pt, s.bbox, Math.max(tol, 2000))) continue;
    const d = distanceToGeometryMeters(pt, s.geometry);
    const closed = s.closed || closuresFor(s, opts.closures ?? [], opts.date).length > 0;
    scored.push({ s, d, closed });
  }
  scored.sort((a, b) => a.d - b.d);
  const nearest = scored.slice(0, 5).map(({ s, d, closed }) => ({
    sectionId: s.id, name: s.name, distanceM: Math.round(d), closed, fishingAllowed: closed ? false : s.fishingAllowed, ruleLabel: s.ruleLabel,
  }));
  const within = scored.filter((x) => x.d <= tol);
  const closedWithin = within.filter((x) => x.closed);
  const allowedWithin = within.filter((x) => !x.closed && x.s.fishingAllowed === true);
  const unclearWithin = within.filter((x) => !x.closed && x.s.fishingAllowed === null);
  const base = { toleranceM: tol, accuracyM, nearest, disclaimer: GPS_DISCLAIMER };
  if (closedWithin.length) {
    const names = [...new Set(closedWithin.map((x) => x.s.name))].join(', ');
    const alsoAllowed = allowedWithin.length ? ' In der Nähe liegen auch erlaubte Abschnitte – bitte genau prüfen.' : '';
    const conflict = closedWithin.some((x) => x.s.conflict) ? ' (Angaben teilweise widersprüchlich, Vorstandsklärung offen)' : '';
    return { ...base, level: 'closed', message: `Achtung: Sie befinden sich vermutlich an einem gesperrten Abschnitt: ${names}${conflict}. Fischen ist hier verboten.${alsoAllowed}` };
  }
  if (allowedWithin.length) {
    const first = allowedWithin[0].s;
    return { ...base, level: 'ok', message: `Sie befinden sich vermutlich am Gewässer «${first.name}» (${first.ruleLabel}).` };
  }
  if (unclearWithin.length) {
    return { ...base, level: 'unclear', message: `Sie befinden sich vermutlich an «${unclearWithin[0].s.name}». Die Regel ist dort noch nicht geklärt (Vorstandsklärung erforderlich).` };
  }
  const n = nearest[0];
  return {
    ...base,
    level: 'outside',
    message: n
      ? `Sie befinden sich vermutlich ausserhalb der erlaubten Gewässer dieser Karte. Nächster Abschnitt: «${n.name}» in ca. ${n.distanceM} m.`
      : 'Sie befinden sich vermutlich ausserhalb des Gebiets dieser Karte.',
  };
}

/** Gewässervorschläge für den Tourstart (nächste Gewässer, eindeutig nach Name). */
export function suggestWaters(pt: Position, sections: Section[], limit = 3, maxDistanceM = 1500) {
  const best = new Map<string, { waterKey: string; name: string; distanceM: number; closed: boolean }>();
  for (const s of sections) {
    if (s.kind !== 'water' || !bboxNear(pt, s.bbox, maxDistanceM)) continue;
    const d = distanceToGeometryMeters(pt, s.geometry);
    if (d > maxDistanceM) continue;
    const cur = best.get(s.waterKey);
    if (!cur || d < cur.distanceM) best.set(s.waterKey, { waterKey: s.waterKey, name: s.name, distanceM: Math.round(d), closed: s.closed });
  }
  return [...best.values()].sort((a, b) => a.distanceM - b.distanceM).slice(0, limit);
}
