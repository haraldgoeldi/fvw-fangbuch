/**
 * Gemeinsame Fachbegriffe für App und Backend.
 * Werte, die der Vorstand noch nicht entschieden hat, sind hier bewusst NICHT hinterlegt
 * (siehe docs/03-offene-entscheidungen.md).
 */

/** Fischarten gemäss Anforderungsdokument §1 (Startwerte; im Admin pflegbar). */
export const DEFAULT_FISH_SPECIES = [
  'Bachforelle',
  'Regenbogenforelle',
  'Äsche',
  'Alet',
  'Barbe',
  'Groppe',
  'Karpfen',
  'Hecht',
  'Nase',
] as const;

/**
 * Technische Plausibilitätsgrenze für Längen (keine Mindestmasse!).
 * Übernommen aus dem bestehenden Web-Prototyp (1–150 cm, ganzzahlig).
 */
export const LENGTH_CM_MIN = 1;
export const LENGTH_CM_MAX = 150;

/** Kartengruppen gemäss Anforderungsdokument §1. */
export type MapGroup = 'aktive' | 'jugend' | 'tageskarte';
export const MAP_GROUPS: { key: MapGroup; title: string; appliesTo: string; expectedObjects: number; expectedNames: number | null; myMapsId: string }[] = [
  { key: 'aktive', title: 'Aktive Fischer 2026 Gewässerkarte', appliesTo: 'Mitglieder mit Patent', expectedObjects: 355, expectedNames: 152, myMapsId: '1ix9IEIuiCC-A4pySRwl-xYhhiiOMXf8' },
  { key: 'jugend', title: 'Jugendfischer 2026 Gewässerkarte', appliesTo: 'Jugendfischer', expectedObjects: 110, expectedNames: 67, myMapsId: '1gneLQ1JulxHv-ZE7Kz2pTtQEb32D_jM' },
  { key: 'tageskarte', title: 'Gewässerkarte 2026 Tageskarte', appliesTo: 'Inhaber einer Tageskarte', expectedObjects: 10, expectedNames: null, myMapsId: '1GOP3PF7BT3ops0HwjviU5NQaVWDJgk0' },
];

/**
 * Bedeutung einer My-Maps-Ebene. Grundsätzlich bestimmt die Ebene die Köderregel (AD §1).
 */
export type LayerKind =
  | 'baits_all'              // Natur- & Kunstköder, Löffel, Wobbler & Spinner
  | 'baits_no_spinner'       // Natur- & Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten)
  | 'gravel_trap_river'      // Kiessämmler (gelten als Fliessgewässer)
  | 'artificial_only_unclear'// Nur Kunstköder (…verboten) – Bedeutung unklar
  | 'voralpsee'              // Voralpsee – eigene Regeln
  | 'closed'                 // gesperrte Gewässer
  | 'lease_boundary'         // Pachtgrenze
  | 'mountain_valley_boundary' // Grenze Berg-/Talgewässer
  | 'empty_unnamed'          // «Unbenannte Ebene» ohne Objekte
  | 'unknown';

/** Status einer Regel in der App. */
export type RuleStatus =
  | 'from_source'        // aus der Quelle übernommen, Bedeutung im AD dokumentiert
  | 'needs_board'        // Vorstandsklärung erforderlich – keine Auslegung anzeigen
  | 'imported_text_only' // nur importierter Text, keine abgeleitete Regel
  | 'conflict'           // Quelle widersprüchlich
  | 'display_only';      // nur Darstellung (Grenzen), keine Rechtsfolge

export interface LayerRule {
  kind: LayerKind;
  /** Kurzer Text für die App. */
  label: string;
  /** Erklärung, was die App daraus ableitet (oder ausdrücklich nicht). */
  meaning: string;
  status: RuleStatus;
  fishingAllowed: boolean | null; // null = nicht anwendbar (Grenzen) oder unklar
  /** Fliessgewässer-Regeln anwenden (nur Kennzeichnung, Inhalte offen: O21). */
  riverRules?: boolean;
  decisionRef?: string;
}

export const LAYER_RULES: Record<LayerKind, LayerRule> = {
  baits_all: {
    kind: 'baits_all', label: 'Alle Köder erlaubt',
    meaning: 'Natur- & Kunstköder, Löffel, Wobbler & Spinner erlaubt.',
    status: 'from_source', fishingAllowed: true,
  },
  baits_no_spinner: {
    kind: 'baits_no_spinner', label: 'Natur- & Kunstköder – ohne Spinner, Löffel, Wobbler, künstl. Köderfische',
    meaning: 'Natur- und Kunstköder erlaubt, ausgenommen Spinner, Löffel, Wobbler und künstliche Köderfische.',
    status: 'from_source', fishingAllowed: true,
  },
  gravel_trap_river: {
    kind: 'gravel_trap_river', label: 'Kiessämmler – gilt als Fliessgewässer',
    meaning: 'Es gelten die Regeln für Fliessgewässer. Welche das konkret sind, ist nicht in den Kartendaten hinterlegt (siehe Regeltext des Abschnitts).',
    status: 'from_source', fishingAllowed: true, riverRules: true, decisionRef: 'O21',
  },
  artificial_only_unclear: {
    kind: 'artificial_only_unclear', label: 'Nur Kunstköder – Vorstandsklärung erforderlich',
    meaning: 'Der Ebenentitel verbietet Spinner, Löffel, Wobbler und künstliche Köderfische. Welche Köder erlaubt sind, ist unklar und vom Vorstand noch nicht geklärt.',
    status: 'needs_board', fishingAllowed: null, decisionRef: 'O8',
  },
  voralpsee: {
    kind: 'voralpsee', label: 'Voralpsee – eigene Regeln',
    meaning: 'Für den Voralpsee gelten eigene Regeln. Angezeigt wird nur der importierte Text; weitere Regeln sind nicht bestätigt.',
    status: 'imported_text_only', fishingAllowed: true, decisionRef: 'O20',
  },
  closed: {
    kind: 'closed', label: 'Gesperrt – Fischen verboten',
    meaning: 'Gesperrtes Gewässer: Fischen verboten.',
    status: 'from_source', fishingAllowed: false,
  },
  lease_boundary: {
    kind: 'lease_boundary', label: 'Pachtgrenze',
    meaning: 'Grenze des Pachtgebiets (Darstellung und Lagehinweis).',
    status: 'display_only', fishingAllowed: null,
  },
  mountain_valley_boundary: {
    kind: 'mountain_valley_boundary', label: 'Grenze Berg-/Talgewässer',
    meaning: 'Trennlinie zwischen Berg- und Talgewässern. Es werden keine Rechtsfolgen abgeleitet.',
    status: 'display_only', fishingAllowed: null, decisionRef: 'O21',
  },
  empty_unnamed: {
    kind: 'empty_unnamed', label: 'Leere, unbenannte Ebene',
    meaning: 'Ebene ohne Objekte; wird nicht angezeigt.', status: 'display_only', fishingAllowed: null,
  },
  unknown: {
    kind: 'unknown', label: 'Unbekannte Ebene – nicht zugeordnet',
    meaning: 'Diese Ebene ist keiner Regel zugeordnet. Ein Admin muss sie zuordnen.', status: 'needs_board', fishingAllowed: null,
  },
};

/** Exakte Ebenentitel aus My Maps (nach Leerzeichen-Normalisierung) → Bedeutung. */
export const LAYER_TITLE_MAP: Record<string, LayerKind> = {
  'Natur- & Kunstköder, Löffel, Wobbler & Spinner': 'baits_all',
  'Natur- & Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten)': 'baits_no_spinner',
  'Kiessämmler (gelten als Fliessgewässer)': 'gravel_trap_river',
  'Nur Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten)': 'artificial_only_unclear',
  'Voralpsee': 'voralpsee',
  'gesperrte Gewässer': 'closed',
  'Pachtgrenze': 'lease_boundary',
  'Grenze Berg-/Talgewässer': 'mountain_valley_boundary',
};

export function normalizeSpaces(s: string): string {
  return s.normalize('NFC').replace(/[  -​  　]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function classifyLayer(title: string, objectCount: number): LayerKind {
  const t = normalizeSpaces(title);
  if (LAYER_TITLE_MAP[t]) return LAYER_TITLE_MAP[t];
  if ((t === '' || /^unbenannte ebene$/i.test(t)) && objectCount === 0) return 'empty_unnamed';
  return 'unknown';
}

/** Rollen gemäss PA §3. */
export type Role = 'member' | 'warden' | 'admin' | 'guest';
export const ROLE_LABELS: Record<Role, string> = {
  member: 'Mitglied',
  warden: 'Aufseher',
  admin: 'Vorstand/Admin',
  guest: 'Gast (Tageskarte)',
};

export type Permission =
  | 'catches.read_own' | 'catches.write_own' | 'catches.export_own'
  | 'catches.read_all' | 'catches.export_all' | 'stats.read_all'
  | 'controls.write' | 'controls.read_own' | 'controls.read_all'
  | 'permits.verify' | 'permits.manage'
  | 'news.read_members' | 'news.write'
  | 'events.read' | 'reports.write'
  | 'admin.access' | 'admin.maps' | 'admin.rules' | 'admin.settings' | 'admin.roles' | 'admin.audit' | 'admin.members' | 'admin.waters'
  | 'maps.read_all_groups';

/** Standard-Berechtigungen je Rolle. Zusätzliche Rechte können pro Person erteilt werden. */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  guest: ['catches.read_own', 'catches.write_own', 'catches.export_own', 'events.read', 'reports.write'],
  member: ['catches.read_own', 'catches.write_own', 'catches.export_own', 'news.read_members', 'events.read', 'reports.write'],
  warden: ['catches.read_own', 'catches.write_own', 'catches.export_own', 'news.read_members', 'events.read', 'reports.write',
    'controls.write', 'controls.read_own', 'permits.verify', 'maps.read_all_groups'],
  admin: ['catches.read_own', 'catches.write_own', 'catches.export_own', 'catches.read_all', 'catches.export_all', 'stats.read_all',
    'controls.write', 'controls.read_own', 'controls.read_all', 'permits.verify', 'permits.manage', 'news.read_members', 'news.write',
    'events.read', 'reports.write', 'admin.access', 'admin.maps', 'admin.rules', 'admin.settings', 'admin.roles', 'admin.audit',
    'admin.members', 'admin.waters', 'maps.read_all_groups'],
};

export function permissionsFor(roles: Role[], extra: Permission[] = [], revoked: Permission[] = []): Permission[] {
  const set = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r] ?? []) set.add(p);
  for (const p of extra) set.add(p);
  for (const p of revoked) set.delete(p);
  return [...set].sort();
}

export type CatchDisposition = 'entnommen' | 'zurueckgesetzt';
export const DISPOSITION_LABELS: Record<CatchDisposition, string> = {
  entnommen: 'entnommen',
  zurueckgesetzt: 'zurückgesetzt',
};

export type TourOutcome = 'catch' | 'null_report';

export type IntegrationKey = 'fairgate' | 'eventfrog' | 'mail' | 'push' | 'website' | 'mymaps' | 'sms';
export type IntegrationMode = 'not_configured' | 'test' | 'active' | 'error';
export const INTEGRATION_MODE_LABELS: Record<IntegrationMode, string> = {
  not_configured: 'nicht eingerichtet',
  test: 'Testmodus',
  active: 'aktiv',
  error: 'Fehler',
};
