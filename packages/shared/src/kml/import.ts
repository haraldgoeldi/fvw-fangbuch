/**
 * Kartenimport: KML → Gewässerabschnitte + Importbericht (Datenqualität).
 *
 * Grundsätze (PA §2):
 *  - Quelldaten werden nie stillschweigend verändert. Jede Normalisierung ist ein «Befund» mit
 *    Originalwert, Vorschlag und Status. Erst ein vom Admin bestätigter Befund ändert die Anzeige.
 *  - Regeln gelten pro Abschnitt (Placemark), nicht pro Gewässername.
 *  - Die Ebene bestimmt die Köderregel; die Beschreibung liefert Code und Regeltext.
 */
import { classifyLayer, LAYER_RULES, normalizeSpaces, type LayerKind, type MapGroup, type RuleStatus } from '../domain';
import { geometryBBox, mergeBBox, type BBox } from '../geo';
import { findDoubledCapitals, parseDescription, type ParsedDescription } from './description';
import { colorFromStyleUrl, parseKml, type Geometry, type KmlDocument, type KmlPlacemark } from './parse';

export type IssueSeverity = 'info' | 'warnung' | 'fehler';
export type IssueStatus = 'offen' | 'bestaetigt' | 'abgelehnt';

export type IssueKind =
  | 'network_link_only'
  | 'count_mismatch'
  | 'layer_count_mismatch'
  | 'unknown_layer'
  | 'empty_layer'
  | 'name_whitespace'
  | 'name_variant_known'
  | 'name_variant_possible'
  | 'clubhouse_name_variant'
  | 'code_format'
  | 'code_missing'
  | 'rule_text_typo'
  | 'description_whitespace'
  | 'closed_in_rule_layer'
  | 'temporal_free_text'
  | 'rule_unclear'
  | 'rule_text_differs'
  | 'multiple_codes_per_name'
  | 'point_in_rule_layer'
  | 'online_only_photo';

export interface ImportIssue {
  id: string;
  kind: IssueKind;
  severity: IssueSeverity;
  title: string;
  maps: MapGroup[];
  layer: string | null;
  field: 'name' | 'description' | 'code' | 'layer' | 'geometry' | 'count' | null;
  original: string | null;
  suggestion: string | null;
  /** Anzahl betroffener Objekte. */
  occurrences: number;
  /** Abschnitts-IDs (gekürzt auf max. 50). */
  sectionIds: string[];
  note: string;
  decisionRef?: string;
  /** Ob eine Bestätigung den Anzeigewert ändern darf (nur bei Vorschlag). */
  normalizable: boolean;
  status: IssueStatus;
}

export interface Section {
  id: string;
  group: MapGroup;
  placemarkIndex: number;
  layerIndex: number;
  layerName: string;
  layerKind: LayerKind;
  name: string;
  nameOriginal: string;
  waterKey: string;
  code: number | null;
  codeOriginal: string | null;
  ruleText: string | null;
  ruleTextOriginal: string | null;
  ruleLabel: string;
  ruleMeaning: string;
  ruleStatus: RuleStatus;
  fishingAllowed: boolean | null;
  closed: boolean;
  conflict: string | null;
  temporalText: string | null;
  kind: 'water' | 'orientation_point' | 'lease_boundary' | 'mountain_valley_boundary';
  isClubhouse: boolean;
  riverRules: boolean;
  decisionRefs: string[];
  photoUrls: string[];
  color: string | null;
  geometryType: Geometry['type'];
  geometry: Geometry;
  bbox: BBox;
}

export interface LayerSummary {
  index: number;
  name: string;
  kind: LayerKind;
  ruleLabel: string;
  ruleStatus: RuleStatus;
  objects: number;
  expectedObjects: number | null;
  geometry: { Point: number; LineString: number; Polygon: number; GeometryCollection: number };
}

export interface MapImportStats {
  group: MapGroup;
  documentName: string;
  sha256: string | null;
  bytes: number | null;
  objects: number;
  expectedObjects: number | null;
  distinctNames: number;
  expectedNames: number | null;
  codes: number[];
  layers: LayerSummary[];
  bbox: BBox | null;
  networkLinkOnly: boolean;
}

export interface WaterEntry {
  key: string;
  name: string;
  groups: MapGroup[];
  codes: number[];
  sectionIds: string[];
  layerKinds: LayerKind[];
  hasClosedSection: boolean;
  bbox: BBox;
}

export interface MapImportInput {
  group: MapGroup;
  kml: string;
  sha256?: string | null;
  bytes?: number | null;
  expectedObjects?: number | null;
  expectedNames?: number | null;
  /** Erwartete Objekte pro Ebenentitel (laut Anforderungsdokument). */
  expectedLayerCounts?: Record<string, number>;
}

/** Admin-Entscheide zu Befunden (Issue-ID → Status und ggf. abweichender Wert). */
export type IssueDecisions = Record<string, { status: IssueStatus; value?: string | null }>;

export interface ImportResult {
  stats: MapImportStats[];
  sections: Section[];
  waters: WaterEntry[];
  issues: ImportIssue[];
}

/** Anforderungsdokument §1, Tabelle «Aufbau der Kartendaten». */
export const EXPECTED_LAYER_COUNTS: Record<MapGroup, Record<string, number>> = {
  aktive: {
    'Natur- & Kunstköder, Löffel, Wobbler & Spinner': 8,
    'Natur- & Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten)': 293,
    'Kiessämmler (gelten als Fliessgewässer)': 17,
    'Nur Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten)': 3,
    'Voralpsee': 1, 'gesperrte Gewässer': 29, 'Pachtgrenze': 3, 'Grenze Berg-/Talgewässer': 1,
  },
  jugend: {
    'Natur- & Kunstköder, Löffel, Wobbler & Spinner': 7,
    'Natur- & Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten)': 62,
    'Kiessämmler (gelten als Fliessgewässer)': 10,
    'Nur Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten)': 3,
    'Voralpsee': 1, 'gesperrte Gewässer': 24, 'Pachtgrenze': 2, 'Grenze Berg-/Talgewässer': 1,
  },
  tageskarte: {
    'Natur- & Kunstköder, Löffel, Wobbler & Spinner': 5,
    'Nur Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten)': 2,
    'gesperrte Gewässer': 1, 'Pachtgrenze': 2,
  },
};

/** Im Anforderungsdokument ausdrücklich genannte Schreibvarianten. */
export const KNOWN_NAME_VARIANTS: string[][] = [
  ['Lognerbach', 'Loggnerbach'],
  ['Rogghalbtobel', 'Rogghalmtobel'],
];

const CLUBHOUSE_RE = /fischerheim|vereinslokal|fischerei\s*verein|fvw/i;

/** cyrb53 – schneller, stabiler 53-bit-Hash für deterministische IDs. */
export function hash53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function waterKeyOf(name: string): string {
  return normalizeSpaces(name).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function geometryKey(g: Geometry | null): string {
  if (!g) return 'null';
  return JSON.stringify(g).slice(0, 4000) + ':' + JSON.stringify(g).length;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[m][n];
}

/** Bereinigt Leerraum in Namen (Ränder, Mehrfach-Leerzeichen, Leerzeichen nach «(» bzw. vor «)»). */
export function cleanNameWhitespace(name: string): string {
  return normalizeSpaces(name).replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
}

interface Work {
  pm: KmlPlacemark;
  group: MapGroup;
  desc: ParsedDescription;
  layerKind: LayerKind;
  id: string;
}

export function importMaps(inputs: MapImportInput[], decisions: IssueDecisions = {}): ImportResult {
  const issues: ImportIssue[] = [];
  const stats: MapImportStats[] = [];
  const work: Work[] = [];
  const docs: { input: MapImportInput; doc: KmlDocument }[] = [];

  const addIssue = (i: Omit<ImportIssue, 'status'>) => {
    const d = decisions[i.id];
    issues.push({ ...i, sectionIds: i.sectionIds.slice(0, 50), status: d?.status ?? 'offen' });
  };

  for (const input of inputs) {
    const doc = parseKml(input.kml);
    docs.push({ input, doc });
    if (doc.networkLinkOnly) {
      addIssue({
        id: `network_link_only:${input.group}`, kind: 'network_link_only', severity: 'fehler',
        title: 'Datei enthält nur einen Netzwerklink, keine Kartendaten',
        maps: [input.group], layer: null, field: null, original: doc.networkLinks.map((l) => l.href).join(' '), suggestion: null,
        occurrences: 0, sectionIds: [], normalizable: false,
        note: 'Die Basisdaten müssen aus der zugehörigen KML-Datei oder über den Netzwerklink (Backend) importiert werden.',
      });
    }
    const seen = new Map<string, number>();
    for (const pm of doc.placemarks) {
      const layer = doc.layers.find((l) => l.index === pm.layerIndex);
      const layerKind = classifyLayer(pm.layerName, layer?.placemarkCount ?? 0);
      const base = `${input.group}|${normalizeSpaces(pm.layerName)}|${pm.name}|${geometryKey(pm.geometry)}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      work.push({ pm, group: input.group, desc: parseDescription(pm.description), layerKind, id: `${input.group}-${hash53(base + (n ? `#${n}` : ''))}` });
    }

    // Statistik
    const names = new Set(doc.placemarks.map((p) => p.name));
    const codes = new Set<number>();
    let bbox: BBox | null = null;
    for (const w of work.filter((x) => x.group === input.group)) {
      if (w.desc.code !== null) codes.add(w.desc.code);
      if (w.pm.geometry) bbox = bbox ? mergeBBox(bbox, geometryBBox(w.pm.geometry)) : geometryBBox(w.pm.geometry);
    }
    const expectedLayers = input.expectedLayerCounts ?? {};
    const layers: LayerSummary[] = doc.layers.map((l) => {
      const kind = classifyLayer(l.name, l.placemarkCount);
      const geometry = { Point: 0, LineString: 0, Polygon: 0, GeometryCollection: 0 };
      for (const p of doc.placemarks) if (p.layerIndex === l.index && p.geometry) geometry[p.geometry.type]++;
      const exp = expectedLayers[normalizeSpaces(l.name)];
      return {
        index: l.index, name: l.name, kind, ruleLabel: LAYER_RULES[kind].label, ruleStatus: LAYER_RULES[kind].status,
        objects: l.placemarkCount, expectedObjects: exp ?? null, geometry,
      };
    });
    stats.push({
      group: input.group, documentName: doc.name, sha256: input.sha256 ?? null, bytes: input.bytes ?? null,
      objects: doc.placemarks.length, expectedObjects: input.expectedObjects ?? null,
      distinctNames: names.size, expectedNames: input.expectedNames ?? null,
      codes: [...codes].sort((a, b) => a - b), layers, bbox, networkLinkOnly: doc.networkLinkOnly,
    });

    if (input.expectedObjects != null && input.expectedObjects !== doc.placemarks.length) {
      addIssue({
        id: `count_mismatch:${input.group}:objects`, kind: 'count_mismatch', severity: 'warnung',
        title: `Objektzahl weicht ab: ${doc.placemarks.length} statt ${input.expectedObjects}`,
        maps: [input.group], layer: null, field: 'count', original: String(doc.placemarks.length), suggestion: null,
        occurrences: 1, sectionIds: [], normalizable: false, note: 'Vergleich mit der Prüfzahl aus dem Anforderungsdokument.',
      });
    }
    if (input.expectedNames != null && input.expectedNames !== names.size) {
      addIssue({
        id: `count_mismatch:${input.group}:names`, kind: 'count_mismatch', severity: 'warnung',
        title: `Anzahl Gewässernamen weicht ab: ${names.size} statt ${input.expectedNames}`,
        maps: [input.group], layer: null, field: 'count', original: String(names.size), suggestion: null,
        occurrences: 1, sectionIds: [], normalizable: false, note: 'Vergleich mit der Prüfzahl aus dem Anforderungsdokument.',
      });
    }
    for (const l of layers) {
      if (l.expectedObjects != null && l.expectedObjects !== l.objects) {
        addIssue({
          id: `layer_count_mismatch:${input.group}:${hash53(l.name)}`, kind: 'layer_count_mismatch', severity: 'warnung',
          title: `Ebene «${l.name}»: ${l.objects} statt ${l.expectedObjects} Objekte`, maps: [input.group], layer: l.name, field: 'count',
          original: String(l.objects), suggestion: null, occurrences: 1, sectionIds: [], normalizable: false, note: 'Vergleich mit der Tabelle im Anforderungsdokument.',
        });
      }
      if (l.kind === 'unknown') {
        addIssue({
          id: `unknown_layer:${input.group}:${hash53(l.name)}`, kind: 'unknown_layer', severity: 'fehler',
          title: `Ebene ohne Regelzuordnung: «${l.name}»`, maps: [input.group], layer: l.name, field: 'layer', original: l.name,
          suggestion: null, occurrences: l.objects, sectionIds: [], normalizable: false,
          note: 'Die Ebene ist keiner bekannten Köderregel zugeordnet. Abschnitte werden als «nicht zugeordnet» angezeigt.',
        });
      }
      if (l.kind === 'empty_unnamed') {
        addIssue({
          id: `empty_layer:${input.group}:${l.index}`, kind: 'empty_layer', severity: 'info',
          title: `Leere Ebene «${l.name || '(ohne Namen)'}»`, maps: [input.group], layer: l.name, field: 'layer', original: l.name,
          suggestion: '(Ebene in My Maps löschen)', occurrences: 0, sectionIds: [], normalizable: false,
          note: 'Die Ebene enthält keine Objekte und wird in der App nicht angezeigt.',
        });
      }
    }
  }

  // ---------- Befunde über alle Karten ----------
  const groupBy = <T>(arr: Work[], key: (w: Work) => T) => {
    const m = new Map<T, Work[]>();
    for (const w of arr) {
      const k = key(w);
      m.set(k, [...(m.get(k) ?? []), w]);
    }
    return m;
  };
  const mapsOf = (ws: Work[]) => [...new Set(ws.map((w) => w.group))];

  // Namen mit unregelmässigem Leerraum
  for (const [name, ws] of groupBy(work, (w) => w.pm.name)) {
    const clean = cleanNameWhitespace(name);
    if (clean !== name) {
      addIssue({
        id: `name_whitespace:${hash53(name)}`, kind: 'name_whitespace', severity: 'info',
        title: `Leerzeichen im Namen «${name}»`, maps: mapsOf(ws), layer: null, field: 'name', original: name, suggestion: clean,
        occurrences: ws.length, sectionIds: ws.map((w) => w.id), normalizable: true, note: 'Nur Leerraum betroffen.',
      });
    }
  }

  // Orientierungspunkte (Vereinslokal/Fischerheim)
  const points = work.filter((w) => w.pm.geometry?.type === 'Point');
  const clubhouse = points.filter((w) => CLUBHOUSE_RE.test(w.pm.name) || CLUBHOUSE_RE.test(w.desc.lines.join(' ')));
  const clubNames = groupBy(clubhouse, (w) => cleanNameWhitespace(w.pm.name));
  if (clubNames.size > 1) {
    const ranked = [...clubNames.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [name, ws] of ranked.slice(1)) {
      addIssue({
        id: `clubhouse_name_variant:${hash53(name)}`, kind: 'clubhouse_name_variant', severity: 'warnung',
        title: `Vereinslokal unterschiedlich benannt: «${name}» / «${ranked[0][0]}»`, maps: mapsOf(ws), layer: ws[0].pm.layerName,
        field: 'name', original: name, suggestion: ranked[0][0], occurrences: ws.length, sectionIds: ws.map((w) => w.id), normalizable: true,
        note: `Vorschlag = häufigere Bezeichnung (${ranked[0][1].length}× in ${mapsOf(ranked[0][1]).join(', ')}). Das AD nennt beide Bezeichnungen.`,
      });
    }
  }
  const pointsInRuleLayers = points.filter((w) => ['baits_all', 'baits_no_spinner', 'artificial_only_unclear', 'voralpsee', 'gravel_trap_river'].includes(w.layerKind));
  for (const [name, ws] of groupBy(pointsInRuleLayers, (w) => w.pm.name)) {
    addIssue({
      id: `point_in_rule_layer:${hash53(name)}`, kind: 'point_in_rule_layer', severity: 'info',
      title: `Punkt «${name}» liegt in einer Köderebene`, maps: mapsOf(ws), layer: ws[0].pm.layerName, field: 'layer', original: ws[0].pm.layerName,
      suggestion: null, occurrences: ws.length, sectionIds: ws.map((w) => w.id), normalizable: false,
      note: 'Der Punkt wird als Orientierungspunkt dargestellt, nicht als Gewässerabschnitt; die Köderregel der Ebene gilt nicht für ihn.',
    });
  }

  // Bekannte und mögliche Schreibvarianten
  const waterWork = work.filter((w) => w.pm.geometry && w.pm.geometry.type !== 'Point' && !['lease_boundary', 'mountain_valley_boundary'].includes(w.layerKind));
  const byClean = groupBy(waterWork, (w) => cleanNameWhitespace(w.pm.name));
  const knownSet = new Set<string>();
  for (const pair of KNOWN_NAME_VARIANTS) {
    const present = pair.filter((n) => byClean.has(n));
    pair.forEach((n) => knownSet.add(n));
    if (present.length < 2) continue;
    const ranked = present.map((n) => ({ n, ws: byClean.get(n)! })).sort((a, b) => b.ws.length - a.ws.length);
    for (const v of ranked.slice(1)) {
      const codes = [...new Set([...v.ws, ...ranked[0].ws].map((w) => w.desc.code).filter((c) => c !== null))];
      const tie = v.ws.length === ranked[0].ws.length;
      addIssue({
        id: `name_variant_known:${hash53(v.n)}`, kind: 'name_variant_known', severity: 'warnung',
        title: `Schreibvariante «${v.n}» / «${ranked[0].n}»`, maps: mapsOf([...v.ws, ...ranked[0].ws]), layer: null, field: 'name',
        original: tie ? `${v.n} (${v.ws.length}×) / ${ranked[0].n} (${ranked[0].ws.length}×)` : v.n,
        suggestion: tie ? null : ranked[0].n, occurrences: v.ws.length, sectionIds: v.ws.map((w) => w.id), normalizable: true,
        note: tie
          ? `Im Anforderungsdokument genannt. Beide Schreibweisen gleich häufig – kein Vorschlag; der Vorstand legt die richtige Schreibweise fest (Admin kann den Wert beim Bestätigen eintragen). Codes: ${codes.join(', ') || '–'}.`
          : `Im Anforderungsdokument genannt. Vorschlag = häufigere Schreibweise (${ranked[0].ws.length}× gegenüber ${v.ws.length}×). Codes: ${codes.join(', ') || '–'}. Richtige Schreibweise vom Vorstand bestätigen.`,
      });
    }
  }
  const cleanNames = [...byClean.keys()].sort((a, b) => a.localeCompare(b, 'de'));
  for (let i = 0; i < cleanNames.length; i++) {
    for (let j = i + 1; j < cleanNames.length; j++) {
      const a = cleanNames[i], b = cleanNames[j];
      if (knownSet.has(a) && knownSet.has(b)) continue;
      if (Math.min(a.length, b.length) < 7) continue;
      if (levenshtein(a.toLowerCase(), b.toLowerCase()) !== 1) continue;
      const wa = byClean.get(a)!, wb = byClean.get(b)!;
      const ca = [...new Set(wa.map((w) => w.desc.code))].filter((c) => c !== null);
      const cb = [...new Set(wb.map((w) => w.desc.code))].filter((c) => c !== null);
      const shared = ca.filter((c) => cb.includes(c));
      addIssue({
        id: `name_variant_possible:${hash53(a + '|' + b)}`, kind: 'name_variant_possible', severity: 'info',
        title: `Mögliche Schreibvariante «${a}» / «${b}»`, maps: [...new Set([...mapsOf(wa), ...mapsOf(wb)])], layer: null, field: 'name',
        original: `${a} (${wa.length}×) / ${b} (${wb.length}×)`, suggestion: null, occurrences: wa.length + wb.length,
        sectionIds: [...wa, ...wb].map((w) => w.id), normalizable: false,
        note: `Namen unterscheiden sich in nur einem Zeichen. Codes ${a}: ${ca.join(', ') || '–'}; ${b}: ${cb.join(', ') || '–'}${shared.length ? ' (gemeinsamer Code ' + shared.join(', ') + ')' : ' (keine gemeinsamen Codes)'}. Kann ein anderes Gewässer sein – kein automatischer Vorschlag.`,
      });
    }
  }

  // Code-Format und fehlende Codes
  for (const [codeRaw, ws] of groupBy(work.filter((w) => w.desc.codeRaw && !w.desc.codeStandard), (w) => w.desc.codeRaw!)) {
    addIssue({
      id: `code_format:${hash53(codeRaw)}`, kind: 'code_format', severity: 'info',
      title: `Uneinheitlicher Code «${codeRaw}»`, maps: mapsOf(ws), layer: ws[0].pm.layerName, field: 'code', original: codeRaw,
      suggestion: `Gewässercode: ${ws[0].desc.code}`, occurrences: ws.length, sectionIds: ws.map((w) => w.id), normalizable: true,
      note: 'Der Code wurde trotzdem erkannt; der Vorschlag betrifft nur die Schreibweise.',
    });
  }
  const ruleLayerKinds: LayerKind[] = ['baits_all', 'baits_no_spinner', 'gravel_trap_river', 'artificial_only_unclear', 'voralpsee'];
  for (const [key, ws] of groupBy(work.filter((w) => ruleLayerKinds.includes(w.layerKind) && w.pm.geometry?.type !== 'Point' && w.desc.code === null), (w) => `${w.pm.name}|${w.pm.layerName}`)) {
    addIssue({
      id: `code_missing:${hash53(key)}`, kind: 'code_missing', severity: 'warnung',
      title: `Kein Gewässercode bei «${ws[0].pm.name}»`, maps: mapsOf(ws), layer: ws[0].pm.layerName, field: 'code', original: ws[0].desc.lines.join(' / ') || '(leer)',
      suggestion: null, occurrences: ws.length, sectionIds: ws.map((w) => w.id), normalizable: false, note: 'Abschnitt in einer Köderebene ohne Gewässercode.',
    });
  }

  // Tippfehler im Regeltext
  for (const w of work) {
    for (const t of findDoubledCapitals(w.desc.ruleText ?? '')) {
      const id = `rule_text_typo:${w.id}:${t.found}`;
      addIssue({
        id, kind: 'rule_text_typo', severity: 'info', title: `Tippfehler im Regeltext bei «${w.pm.name}»: «${t.found}»`,
        maps: [w.group], layer: w.pm.layerName, field: 'description', original: w.desc.ruleText, suggestion: (w.desc.ruleText ?? '').replace(t.found, t.suggestion),
        occurrences: 1, sectionIds: [w.id], normalizable: true, note: 'Verdoppelter Grossbuchstabe am Wortanfang.',
      });
    }
  }
  // Unregelmässiger Leerraum in Beschreibungen
  const wsDesc = work.filter((w) => w.desc.hadIrregularWhitespace);
  for (const [key, ws] of groupBy(wsDesc, (w) => `${w.pm.name}|${w.desc.lines.join('/')}`)) {
    addIssue({
      id: `description_whitespace:${hash53(key)}`, kind: 'description_whitespace', severity: 'info',
      title: `Auffälliger Leerraum in der Beschreibung von «${ws[0].pm.name}»`, maps: mapsOf(ws), layer: ws[0].pm.layerName, field: 'description',
      original: JSON.stringify(ws[0].pm.description.replace(/<img[^>]*>/g, '').slice(0, 160)), suggestion: ws[0].desc.lines.join(' / '),
      occurrences: ws.length, sectionIds: ws.map((w) => w.id), normalizable: false,
      note: 'Für die Anzeige wird Leerraum immer zusammengefasst; der Inhalt ändert sich nicht.',
    });
  }

  // «gesperrt» in einer Köderebene → Widerspruch
  for (const w of work.filter((x) => x.desc.mentionsClosed && ruleLayerKinds.includes(x.layerKind) && !x.desc.temporalText)) {
    addIssue({
      id: `closed_in_rule_layer:${w.id}`, kind: 'closed_in_rule_layer', severity: 'fehler',
      title: `Widerspruch bei «${w.pm.name}»: Köderebene, Beschreibung «${w.desc.lines.join(' ')}»`, maps: [w.group], layer: w.pm.layerName,
      field: 'description', original: w.desc.lines.join(' / '), suggestion: null, occurrences: 1, sectionIds: [w.id], normalizable: false,
      note: 'Die Ebene erlaubt das Fischen, die Beschreibung meldet eine Sperrung. Die App warnt vorsorglich und kennzeichnet den Abschnitt als widersprüchlich.',
      decisionRef: 'O28',
    });
  }
  // Zeitliche Angaben im Freitext
  for (const w of work.filter((x) => x.desc.temporalText)) {
    addIssue({
      id: `temporal_free_text:${w.id}`, kind: 'temporal_free_text', severity: 'warnung',
      title: `Zeitliche Regel nur als Freitext bei «${w.pm.name}»: «${w.desc.temporalText}»`, maps: [w.group], layer: w.pm.layerName,
      field: 'description', original: w.desc.temporalText, suggestion: null, occurrences: 1, sectionIds: [w.id], normalizable: false,
      note: 'Wird nicht automatisch in eine Datumsregel umgedeutet (fehlt z. B. Beginn und Jahr). Admin kann eine strukturierte Sperrzeit (von/bis) erfassen.',
      decisionRef: 'O10',
    });
  }
  // Unklare Köderregel
  for (const [g, ws] of groupBy(work.filter((w) => w.layerKind === 'artificial_only_unclear'), (w) => w.group)) {
    addIssue({
      id: `rule_unclear:${g}`, kind: 'rule_unclear', severity: 'warnung',
      title: 'Köderregel «Nur Kunstköder» unklar – Vorstandsklärung erforderlich', maps: [g], layer: ws[0].pm.layerName, field: 'layer',
      original: ws[0].pm.layerName, suggestion: null, occurrences: ws.length, sectionIds: ws.map((w) => w.id), normalizable: false,
      note: 'Der Titel verbietet Spinner, Löffel, Wobbler und künstliche Köderfische; welche Köder erlaubt sind, ist offen.', decisionRef: 'O8',
    });
  }
  // Regeltext weicht vom Ebenentitel ab
  for (const [key, ws] of groupBy(work.filter((w) => ruleLayerKinds.includes(w.layerKind) && w.pm.geometry?.type !== 'Point' && w.desc.ruleText && !w.desc.mentionsClosed), (w) => `${w.group}|${w.pm.layerName}|${w.desc.ruleText}`)) {
    const layerTitle = normalizeSpaces(ws[0].pm.layerName);
    const rt = normalizeSpaces(ws[0].desc.ruleText!).replace(/\s*erlaubt\.?$/, '');
    if (rt === layerTitle || findDoubledCapitals(rt).length) continue;
    addIssue({
      id: `rule_text_differs:${hash53(key)}`, kind: 'rule_text_differs', severity: 'info',
      title: `Regeltext weicht vom Ebenentitel ab (${ws.length}×)`, maps: mapsOf(ws), layer: ws[0].pm.layerName, field: 'description',
      original: ws[0].desc.ruleText, suggestion: null, occurrences: ws.length, sectionIds: ws.map((w) => w.id), normalizable: false,
      note: `Ebene «${layerTitle}». In der App werden Ebenenregel und Regeltext getrennt angezeigt; es wird nichts zusammengeführt.`,
      decisionRef: ws[0].layerKind === 'voralpsee' ? 'O20' : ws[0].layerKind === 'gravel_trap_river' ? 'O21' : undefined,
    });
  }
  // Mehrere Codes pro Name
  const codesByName = new Map<string, Set<number>>();
  for (const w of work) if (w.desc.code !== null) {
    const n = cleanNameWhitespace(w.pm.name);
    codesByName.set(n, (codesByName.get(n) ?? new Set()).add(w.desc.code));
  }
  const multi = [...codesByName.entries()].filter(([, c]) => c.size > 1);
  if (multi.length) {
    addIssue({
      id: 'multiple_codes_per_name', kind: 'multiple_codes_per_name', severity: 'info',
      title: `${multi.length} Gewässernamen tragen mehrere Gewässercodes`, maps: [...new Set(work.map((w) => w.group))], layer: null, field: 'code',
      original: multi.map(([n, c]) => `${n}: ${[...c].sort().join('/')}`).join('; '), suggestion: null, occurrences: multi.length, sectionIds: [],
      normalizable: false, note: 'Kein Fehler im engeren Sinn: Regeln und Codes gelten pro Abschnitt. Bedeutung der Codes bestätigen.', decisionRef: 'O29',
    });
  }
  // Fotos nur online
  const withPhotos = work.filter((w) => w.desc.imageUrls.length > 0);
  if (withPhotos.length) {
    addIssue({
      id: 'online_only_photo', kind: 'online_only_photo', severity: 'info',
      title: `${withPhotos.length} Objekte mit Foto (nur online verfügbar)`, maps: mapsOf(withPhotos), layer: null, field: 'description',
      original: 'mymaps.usercontent.google.com', suggestion: null, occurrences: withPhotos.length, sectionIds: withPhotos.map((w) => w.id),
      normalizable: false, note: 'Fotos sind in der Beschreibung verlinkt und werden nicht offline gespeichert. Die App zeigt sie nur mit Verbindung.',
    });
  }

  // ---------- Abschnitte mit bestätigten Normalisierungen ----------
  const confirmed = (id: string, fallback: string | null) => {
    const issue = issues.find((i) => i.id === id);
    if (!issue || issue.status !== 'bestaetigt' || !issue.normalizable) return null;
    const d = decisions[id];
    return d?.value ?? issue.suggestion ?? fallback;
  };
  const nameOverrides = new Map<string, string>();
  for (const i of issues) {
    if (!i.normalizable || i.status !== 'bestaetigt' || i.field !== 'name') continue;
    const v = confirmed(i.id, null);
    if (v) for (const sid of i.sectionIds) nameOverrides.set(sid, v);
  }
  const sections: Section[] = [];
  for (const w of work) {
    if (!w.pm.geometry) continue;
    const rule = LAYER_RULES[w.layerKind];
    let name = cleanNameWhitespace(w.pm.name);
    if (nameOverrides.has(w.id)) name = nameOverrides.get(w.id)!;
    let ruleText = w.desc.ruleText;
    const typo = issues.find((i) => i.kind === 'rule_text_typo' && i.sectionIds.includes(w.id));
    if (typo) ruleText = confirmed(typo.id, ruleText) ?? ruleText;
    const isPoint = w.pm.geometry.type === 'Point';
    const isClub = isPoint && (CLUBHOUSE_RE.test(w.pm.name) || CLUBHOUSE_RE.test(w.desc.lines.join(' ')));
    const conflict = w.desc.mentionsClosed && ruleLayerKinds.includes(w.layerKind) && !w.desc.temporalText
      ? 'Ebene erlaubt das Fischen, Beschreibung meldet «gesperrt» – Vorstandsklärung erforderlich (O28).'
      : null;
    const kind: Section['kind'] = isPoint ? 'orientation_point'
      : w.layerKind === 'lease_boundary' ? 'lease_boundary'
      : w.layerKind === 'mountain_valley_boundary' ? 'mountain_valley_boundary' : 'water';
    const refs = new Set<string>();
    if (rule.decisionRef) refs.add(rule.decisionRef);
    if (conflict) refs.add('O28');
    if (w.desc.temporalText) refs.add('O10');
    sections.push({
      id: w.id, group: w.group, placemarkIndex: w.pm.index, layerIndex: w.pm.layerIndex, layerName: w.pm.layerName, layerKind: w.layerKind,
      name, nameOriginal: w.pm.name, waterKey: waterKeyOf(name), code: w.desc.code, codeOriginal: w.desc.codeRaw,
      ruleText: kind === 'water' ? ruleText : null, ruleTextOriginal: w.desc.ruleText,
      ruleLabel: isPoint ? (isClub ? 'Vereinslokal / Fischerheim' : 'Orientierungspunkt') : rule.label,
      ruleMeaning: isPoint ? 'Orientierungspunkt, kein Gewässerabschnitt.' : rule.meaning,
      ruleStatus: conflict ? 'conflict' : isPoint ? 'display_only' : rule.status,
      fishingAllowed: isPoint ? null : conflict ? null : rule.fishingAllowed,
      closed: !isPoint && (w.layerKind === 'closed' || !!conflict),
      conflict, temporalText: w.desc.temporalText, kind, isClubhouse: isClub, riverRules: !!rule.riverRules,
      decisionRefs: [...refs], photoUrls: w.desc.imageUrls, color: colorFromStyleUrl(w.pm.styleUrl),
      geometryType: w.pm.geometry.type, geometry: w.pm.geometry, bbox: geometryBBox(w.pm.geometry),
    });
  }

  // ---------- Gewässerliste ----------
  const wmap = new Map<string, WaterEntry>();
  for (const s of sections) {
    if (s.kind !== 'water') continue;
    const e = wmap.get(s.waterKey) ?? { key: s.waterKey, name: s.name, groups: [], codes: [], sectionIds: [], layerKinds: [], hasClosedSection: false, bbox: s.bbox };
    if (!e.groups.includes(s.group)) e.groups.push(s.group);
    if (s.code !== null && !e.codes.includes(s.code)) e.codes.push(s.code);
    if (!e.layerKinds.includes(s.layerKind)) e.layerKinds.push(s.layerKind);
    e.sectionIds.push(s.id);
    e.hasClosedSection ||= s.closed;
    e.bbox = mergeBBox(e.bbox, s.bbox);
    wmap.set(s.waterKey, e);
  }
  const waters = [...wmap.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  waters.forEach((w) => w.codes.sort((a, b) => a - b));

  const sevOrder: Record<IssueSeverity, number> = { fehler: 0, warnung: 1, info: 2 };
  issues.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity] || a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title, 'de'));
  return { stats, sections, waters, issues };
}
