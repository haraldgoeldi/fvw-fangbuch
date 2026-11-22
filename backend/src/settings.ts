import { one, q, type Queryable } from './db';

/**
 * Administrierbare Einstellungen. Werte, die der Vorstand noch nicht festgelegt hat, haben den
 * Startwert `null` und werden in der Adminoberfläche als «nicht festgelegt» angezeigt.
 */
export interface SettingDef {
  key: string;
  group: string;
  label: string;
  description: string;
  type: 'int' | 'string' | 'email' | 'bool' | 'enum' | 'string[]' | 'json';
  options?: string[];
  default: unknown;
  /** Verweis auf offene Vorstandsentscheidung. */
  decisionRef?: string;
  /** Technischer Parameter (keine Vereinsregel). */
  technical?: boolean;
}

export const SETTINGS: SettingDef[] = [
  { key: 'season.current_year', group: 'Saison', label: 'Aktuelle Saison', description: 'Jahr der aktiven Saison (Kartenzuordnung, Rücklaufquote).', type: 'int', default: 2026 },
  { key: 'roles.source', group: 'Rollen', label: 'Rollenquelle', description: 'Rollen aus einer Fairgate-Gruppe übernehmen oder in der App pflegen.', type: 'enum', options: ['app', 'fairgate'], default: 'app', decisionRef: 'O23' },
  { key: 'roles.fairgate_group_warden', group: 'Rollen', label: 'Fairgate-Gruppe «Aufseher»', description: 'Name der Fairgate-Gruppe für die Rolle Aufseher (nur bei Rollenquelle Fairgate).', type: 'string', default: null, decisionRef: 'O23' },
  { key: 'roles.fairgate_group_admin', group: 'Rollen', label: 'Fairgate-Gruppe «Vorstand/Admin»', description: 'Name der Fairgate-Gruppe für die Rolle Vorstand/Admin (nur bei Rollenquelle Fairgate).', type: 'string', default: null, decisionRef: 'O23' },
  { key: 'guest.grace_days', group: 'Gäste', label: 'Nachmeldefrist Gastzugang (Tage)', description: 'Tage nach Ablauf der Tageskarte, in denen der Gast noch Fangmeldungen nachtragen kann. Nicht festgelegt = Zugang endet mit der Kartengültigkeit.', type: 'int', default: null, decisionRef: 'O12' },
  { key: 'guest.retention_days', group: 'Gäste', label: 'Löschfrist Gastdaten (Tage nach Zugangsende)', description: 'Danach werden Personendaten von Gästen gelöscht; Fangdaten bleiben anonymisiert. Nicht festgelegt = keine automatische Löschung.', type: 'int', default: null, decisionRef: 'O12' },
  { key: 'retention.controls_days', group: 'Aufbewahrung', label: 'Aufbewahrung Kontrollen/Vergehen (Tage)', description: 'Nicht festgelegt = keine automatische Löschung.', type: 'int', default: null, decisionRef: 'O25' },
  { key: 'retention.reports_days', group: 'Aufbewahrung', label: 'Aufbewahrung Meldungen Verschmutzung (Tage)', description: 'Nicht festgelegt = keine automatische Löschung.', type: 'int', default: null, decisionRef: 'O25' },
  { key: 'control.confirmation_method', group: 'Kontrolle', label: 'Bestätigung durch Aufseher', description: 'Art der Unterzeichnung einer Kontrolle. Noch nicht beschlossen.', type: 'enum', options: ['nicht_festgelegt', 'keine', 'pin', 'unterschrift', 'qr'], default: 'nicht_festgelegt', decisionRef: 'O3' },
  { key: 'control.violation_required_fields', group: 'Kontrolle', label: 'Pflichtfelder Vergehensmeldung', description: 'Felder, die beim Melden eines möglichen Vergehens ausgefüllt sein müssen.', type: 'string[]', options: ['firstName', 'lastName', 'description', 'photo'], default: ['description'], decisionRef: 'O24' },
  { key: 'tour.permit_check', group: 'Fangbuch', label: 'Patentprüfung beim Tourstart', description: 'Hinweis anzeigen oder Tourstart ohne passendes gültiges Patent sperren.', type: 'enum', options: ['hinweis', 'sperre'], default: 'hinweis', decisionRef: 'O30' },
  { key: 'recipients.event_registration', group: 'Empfänger', label: 'Empfänger Terminanmeldungen', description: 'Adresse(n), an die Terminanmeldungen gesendet werden (Komma-getrennt).', type: 'email', default: 'harald.goeldi@gmail.com' },
  { key: 'recipients.incident_report', group: 'Empfänger', label: 'Empfänger Meldungen (Verschmutzung, tote Fische)', description: 'Adresse(n) für Meldungen (Komma-getrennt).', type: 'email', default: 'harald.goeldi@gmail.com' },
  { key: 'recipients.incident_delivery', group: 'Empfänger', label: 'Versandart Meldungen', description: '«E-Mail» = an die Empfängeradresse (im Entwurfsmodus nur als Entwurf); «nur Admin» = nur im Adminbereich sichtbar.', type: 'enum', options: ['email', 'nur_admin'], default: 'email' },
  { key: 'recipients.admin_alerts', group: 'Empfänger', label: 'Empfänger Admin-Hinweise', description: 'Adresse für Hinweise wie «Gewässerkarte geändert» oder Integrationsfehler. Nicht festgelegt = nur Anzeige im Adminbereich.', type: 'email', default: null },
  { key: 'eventfrog.event_ids', group: 'Tageskarten', label: 'Eventfrog-Event-IDs der Tageskarten', description: 'Nummern der Eventfrog-Events, über die Tageskarten verkauft werden (Komma-getrennt). Die Nummer steht in Eventfrog in der Adresse des Events bzw. in den Event-Einstellungen. Leer = kein Abgleich.', type: 'string[]', default: [] },
  { key: 'eventfrog.date_field', group: 'Tageskarten', label: 'Personalisierungsfeld «Fischtag»', description: 'Titel des Eventfrog-Personalisierungsfelds, in dem Käufer den Fischtag wählen (z. B. «Datum»). Nicht festgelegt = die Tageskarte gilt am Kaufdatum.', type: 'string', default: null },
  { key: 'reminders.enabled', group: 'Erinnerungen', label: 'Erinnerungen an offene Fangmeldungen', description: 'Push am Abend des Fischtags und E-Mail am Folgetag (optional, AD §5).', type: 'bool', default: false },
  { key: 'reminders.evening_hour', group: 'Erinnerungen', label: 'Uhrzeit Abend-Erinnerung', description: 'Stunde (0–23) für die Push-Erinnerung am Fischtag.', type: 'int', default: null },
  { key: 'reminders.season_end_days', group: 'Erinnerungen', label: 'Erinnerung vor Saisonende (Tage)', description: 'Tage vor Saisonende für die Erinnerung an Mitglieder.', type: 'int', default: null, decisionRef: 'O26' },
  { key: 'news.push_important', group: 'News', label: 'Push bei wichtigen Meldungen', description: 'Bei als «wichtig» markierten News (z. B. kurzfristige Sperrung) eine Push-Nachricht auslösen.', type: 'bool', default: false },
  { key: 'map.auto_activate', group: 'Karten', label: 'Geänderte Karten automatisch aktivieren', description: 'Aus: neue Versionen aus My Maps müssen vom Admin geprüft und aktiviert werden.', type: 'bool', default: false },
  { key: 'location.tolerance_m', group: 'Karten', label: 'Toleranz Lagehinweis (m)', description: 'Technischer Parameter für GPS-Hinweise (Linien sind Gewässerachsen). Keine Vereinsregel.', type: 'int', default: 50, technical: true },
  { key: 'features.live_location', group: 'Funktionen', label: 'Live-Standort teilen', description: 'Spätere Funktion, derzeit deaktiviert. Nur die einfache Link-Variante ist aktiv.', type: 'bool', default: false, decisionRef: 'O16' },
  { key: 'members.eligible_statuses', group: 'Mitglieder', label: 'Mitgliederstatus mit App-Zugang', description: 'Fairgate-Status, die sich anmelden dürfen. AD §4: «aktives Mitglied».', type: 'string[]', default: ['aktiv'], decisionRef: 'O31' },
];

const DEF = new Map(SETTINGS.map((s) => [s.key, s]));

export async function getSetting<T = unknown>(db: Queryable, key: string): Promise<T> {
  const row = await one<{ value: any }>(db, 'SELECT value FROM app_setting WHERE key = $1', [key]);
  if (row) return row.value?.v as T;
  const d = DEF.get(key);
  if (!d) throw new Error(`Unbekannte Einstellung ${key}`);
  return d.default as T;
}

export async function getAllSettings(db: Queryable) {
  const rows = await q<{ key: string; value: any; version: number; updated_at: string }>(db, 'SELECT key, value, version, updated_at FROM app_setting');
  const m = new Map(rows.map((r) => [r.key, r]));
  return SETTINGS.map((d) => {
    const r = m.get(d.key);
    return { ...d, value: r ? r.value?.v : d.default, version: r?.version ?? 0, updatedAt: r?.updated_at ?? null, isDefault: !r };
  });
}

export function validateSetting(key: string, value: unknown): string | null {
  const d = DEF.get(key);
  if (!d) return 'Unbekannte Einstellung';
  if (value === null) return null;
  switch (d.type) {
    case 'int': return Number.isInteger(value) && (value as number) >= 0 ? null : 'Ganze Zahl ≥ 0 erwartet';
    case 'bool': return typeof value === 'boolean' ? null : 'Ja/Nein erwartet';
    case 'enum': return d.options!.includes(value as string) ? null : `Erlaubt: ${d.options!.join(', ')}`;
    case 'email': {
      if (typeof value !== 'string') return 'E-Mail erwartet';
      const parts = value.split(',').map((s) => s.trim()).filter(Boolean);
      return parts.length && parts.every((p) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p)) ? null : 'Ungültige E-Mail-Adresse';
    }
    case 'string': return typeof value === 'string' ? null : 'Text erwartet';
    case 'string[]':
      if (key === 'eventfrog.event_ids') return Array.isArray(value) && value.every((v) => typeof v === 'string' && /^\d+$/.test(v)) ? null : 'Nur Ziffern, mehrere durch Komma getrennt';
      return Array.isArray(value) && value.every((v) => typeof v === 'string' && (!d.options || d.options.includes(v))) ? null : 'Liste erwartet';
    default: return null;
  }
}

export async function setSetting(db: Queryable, key: string, value: unknown, actor: string | null) {
  const r = await one<{ version: number }>(db,
    `INSERT INTO app_setting(key, value, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = app_setting.version + 1, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING version`, [key, { v: value }, actor]);
  await q(db, 'INSERT INTO app_setting_history(key, value, version, changed_by) VALUES ($1,$2,$3,$4)', [key, { v: value }, r!.version, actor]);
  return r!.version;
}
