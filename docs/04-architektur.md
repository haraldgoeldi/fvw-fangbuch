# 4 Architektur, Datenmodell, Rollen, Navigation

## 4.1 Überblick

```
┌──────────────────────────── Mobile App (iOS/Android, Expo SDK 58 / React Native 0.88) ─────────────────────────────┐
│  Bildschirme (expo-router)   Lokale DB (SQLite + SQLCipher)   Outbox-Sync   Offline-Karte (MBTiles + SVG)          │
│  Ausweis-Prüfung (Ed25519)   Standort nur mit Zustimmung      Sitzungstoken im Keychain/Keystore                  │
└───────────────▲──────────────────────────────────────────────────────────────────────────────────────────────────┘
                │ HTTPS, Bearer-Token, JSON (keine Geheimnisse in der App)
┌───────────────┴──────────── Backend (Node 22, TypeScript, Hono) ─────────────────────────────────────────────────┐
│  Better Auth (E-Mail-Einmalcode, Sitzungen)   Rollen-/Eigentumsprüfung   Sync-API (idempotent)   Admin-API          │
│  Kartenversionen + tägliche Prüfung           Integrationsadapter: Fairgate · Eventfrog · E-Mail · Push · Website  │
│  Admin-Weboberfläche (/admin)                 Jobs (Kartenprüfung, Abgleiche, Wiederholungen, Löschfristen)        │
└───────────────▲──────────────────────────────────────────────────────────────────────────────────────────────────┘
                │
        PostgreSQL 16 (getrennte Test- und Produktivdatenbank), Dateiablage für Fotos
```

Gemeinsame Fachlogik liegt in `packages/shared` und wird von App, Backend und Tests identisch verwendet. Dazu gehören KML-Import, Köderregeln, Datenqualitätsprüfungen, Geometrie, Lagehinweis, Validierung, CSV und das Sync-Protokoll.

## 4.2 Technologiewahl (Vorschlag, offener Punkt O5)

| Bereich | Wahl | Begründung |
|---|---|---|
| App | **Expo / React Native** (TypeScript) | Eine Codebasis für iOS und Android, echte installierbare App. Builds lokal (`expo run:*`) oder in der Cloud (EAS) ohne eigenen Mac-Build-Server. Breite Verbreitung und Wartbarkeit für einen Verein. |
| Lokale Daten | **expo-sqlite mit SQLCipher** | Transaktional und absturzsicher (WAL, `synchronous=FULL`), verschlüsselt. Der Schlüssel liegt im Keychain/Keystore. |
| Karte | **Eigene SVG-Kartenansicht** + MBTiles | Läuft vollständig offline, ohne Google-Maps-/Mapbox-Schlüssel und ohne Lizenzkosten. Die Darstellung richtet sich nach dem Regelstatus (pro Abschnitt). |
| Kartenhintergrund | **swisstopo Landeskarte 1:25'000** über den Downloadservice | Die BGDI-Bedingungen verlangen für Offline-Nutzung den Downloadservice. Er ist kostenlos, Quellenangabe Pflicht (siehe [07-integrationen.md](07-integrationen.md)). |
| Backend | **Node 22 + Hono + PostgreSQL 16** | Robuste und verbreitete Bausteine. Gleiche Sprache wie die App, gemeinsame Fachlogik. |
| Anmeldung | **Better Auth** (Open Source) mit E-Mail-OTP und Bearer-Plugin | Etablierter Auth-Baustein, selbst gehostet (Daten bleiben beim Verein, nDSG), keine Passwörter. Supabase Auth wäre eine gleichwertige Alternative (AD §4). |
| Ausweis | **Ed25519-signierter QR-Code** | Die Aufseher-App prüft offline ohne Zugriff auf fremde Daten. Die Sperrliste kommt mit der Synchronisation. |

## 4.3 Datenmodell (PostgreSQL, `backend/src/migrations/001_init.sql`)

| Bereich | Tabellen | Bemerkungen |
|---|---|---|
| Personen & Rollen | `person`, `access_code`, Better-Auth-Tabellen `user`, `session`, `account`, `verification` | `person.kind` = member/guest. Mitgliederdaten stammen aus Fairgate (`fairgate_id`, `fairgate_status`, `fairgate_groups`), sonst nichts. Rollen werden in der App gepflegt (`roles`) oder aus Fairgate-Gruppen abgeleitet (Einstellung). Zusatzrechte und Entzug pro Person sind möglich. |
| Saison & Patente | `season`, `permit_type`, `permit`, `guest_order` | Patentarten sind frei konfigurierbar, **ohne Preisfelder**. `permit.credential_code` = Ausweis-Nr.; `payment_status` ist ein freier Text. Eventfrog-Bestellungen werden Gastkonten zugeordnet. |
| Karten & Regeln | `map_source`, `map_version`, `map_check`, `map_issue_decision`, `layer_rule`, `closure`, `water`, `fish_species` | Die KML wird pro Version vollständig mit SHA-256 gespeichert. Admin-Entscheide zu Importbefunden gelten versionsübergreifend (deterministische IDs). Sperrzeiten sind strukturiert (von/bis). |
| Fangbuch | `tour`, `catch`, `season_report` | IDs werden auf dem Gerät erzeugt (UUID) und tragen eine Versionsnummer. Gespeichert wird nur das Gewässer, keine Koordinaten. |
| Nachvollziehbarkeit | `record_revision`, `sync_op`, `sync_conflict`, `audit_log` | Jede Version jedes Datensatzes, Idempotenzschlüssel, Konflikte mit beiden Ständen und das Adminprotokoll. |
| Inhalte | `news`, `event`, `event_registration`, `incident_report`, `photo` | Gewässerzustand ist eine News-Kategorie mit Gewässerbezug und Ablaufdatum. |
| Kontrollen | `control`, `violation` | Sichtbar nur für den erfassenden Aufseher und Admins. Nach Abschluss unveränderlich. |
| Versand & Betrieb | `mail_outbox`, `push_outbox`, `push_device`, `integration_status`, `integration_log`, `app_setting(_history)`, `open_decision`, `deletion_request` | Im Entwurfsmodus wird nichts versendet. Einstellungen sind versioniert. |

**Lokale App-Datenbank** (`app/src/lib/db.ts`):

| Tabelle | Inhalt |
|---|---|
| `record` | Eigene Datensätze (Tour, Fang, Meldung, Kontrolle …) als JSON, mit Server-Version und Sync-Zustand |
| `outbox` | Ausstehende Operationen in Reihenfolge, mit `op_id` (Idempotenz) und `prev_op_id` (Kausalkette) |
| `photo` | Lokal gespeicherte Fotos bis zum Upload |
| `map_bundle` | Kartenpaket pro Kartengruppe (Abschnitte, Regeln, Sperrzeiten) mit ETag |
| `kv` | Bootstrap (Profil, Patente, Einstellungen), News- und Termin-Cache, Zeitpunkt der Synchronisation |

## 4.4 Synchronisation

1. Jede Eingabe schreibt Datensatz **und** Operation in **einer** lokalen Transaktion. Die Transaktionen laufen nacheinander über eine App-weite Sperre.
2. `POST /api/app/sync/push` wendet die Operationen der Reihe nach an. Bereits bekannte `opId` → `duplicate`, es entstehen also keine Duplikate bei Wiederholungen oder verlorenen Antworten.
3. Versionsprüfung: Eine Operation auf veraltetem Stand gilt nicht als Konflikt, wenn ihre Vorgängeroperation (`prevOpId`) genau zu diesem Stand geführt hat. Das ist der normale Offline-Ablauf.
4. Bei echtem Konflikt gilt:
   - **Eigene Änderung gegen eigene ältere Änderung:** Der Gerätestand gewinnt. Der überschriebene Stand bleibt in `record_revision` und `sync_conflict` (automatisch gelöst).
   - **Änderung gegen Admin-Änderung:** Der Gerätestand wird **nicht** angewendet. Ein offener Konflikt speichert beide Stände; der Admin entscheidet.
5. Abgelehnte Operationen (z. B. Validierung) bleiben auf dem Gerät sichtbar, mit Begründung und der Möglichkeit, sie erneut zu versuchen.
6. `GET /api/app/sync/pull?since=…` holt eigene Datensätze anderer Geräte. Lokal ausstehende Datensätze werden dabei nie überschrieben.
7. Auslöser: Start, Wiederverbindung, Rückkehr in die App, jede Eingabe (online) sowie jede Minute.

## 4.5 Rollenmatrix (serverseitig geprüft, `packages/shared/src/domain.ts`)

| Recht | Gast (Tageskarte) | Mitglied | Aufseher | Vorstand/Admin |
|---|:-:|:-:|:-:|:-:|
| Eigene Touren/Fänge erfassen, sehen, CSV | ✓ | ✓ | ✓ | ✓ |
| Fänge **aller** Mitglieder, vereinsweite Statistik | – | – | – (nur mit Zusatzrecht) | ✓ |
| Karten | nur Tageskarte | Karten der eigenen Patente (ohne Patent: alle zur Information) | alle | alle |
| News «nur Mitglieder» lesen | – | ✓ | ✓ | ✓ |
| News/Gewässerzustand erfassen | – | Zusatzrecht `news.write` | Zusatzrecht | ✓ |
| Meldung Verschmutzung | ✓ | ✓ | ✓ | ✓ |
| Kontrolle durchführen, Ausweis prüfen | – | – | ✓ (nur eigene Kontrollen sichtbar) | ✓ |
| Alle Kontrollen/Vergehen einsehen | – | – | – | ✓ (Abruf wird protokolliert) |
| Patente, Rollen, Einstellungen, Karten, Regeln, Protokoll | – | – | – | ✓ |

Eigentum: Touren, Fänge, Meldungen und Kontrollen können nur von der erfassenden Person geändert werden. Fremde IDs werden abgelehnt (durch Tests belegt).

## 4.6 Navigationsstruktur der App

```
Anmeldung (E-Mail-Code · Ticketnummer · Zugangscode)
└── Tabs
    ├── Start         Status (offline/ausstehend), laufende Tour, «Fangmeldung offen», Patentstatus, News
    ├── Fischen       Gewässer wählen (Liste, Suche, Standort-Vorschlag, fehlendes Gewässer) → Start
    │                 → Timer, Pause, Fang erfassen (Art, Länge, Verbleib), Fänge, Stop → Fangmeldung/Nullmeldung
    ├── Karte         Kartenwechsel, Standort (freiwillig), Lagehinweis, Abschnittsdetails, Legende, Kartenstand
    ├── Fangbuch      Filter, «nur meine/alle Mitglieder» (Admin), CSV, Korrektur mit Grund, Saisonmeldung
    └── Mehr
        ├── Patent / Tageskarte (QR-Ausweis, offline)
        ├── News & Gewässerzustand (Erfassen für Berechtigte)
        ├── Termine & Aktivitäten (Kalender, Anmeldung)
        ├── Meldung Verschmutzung / tote Fische
        ├── Kontrolle (Aufseher)
        ├── Adminbereich (Kurzübersicht, Link zur Admin-Weboberfläche)
        ├── Profil & Einstellungen (Standort, Detailkarte, Datenexport, Löschantrag, Abmelden)
        └── Status (Synchronisation, Kartenstand, Integrationen, offene Vorstandsentscheide)
```

Die Admin-Weboberfläche (`/admin`) gliedert sich in: Übersicht · Offene Entscheide · Kartenversionen (Import, Bericht, Vorschau, Aktivieren, Rückkehr) · Importbefunde · Köderregeln · Sperrzeiten · Gewässer · Fischarten · Fänge · Rücklaufquote · Sync-Konflikte · Patentarten & Patente · Personen & Rollen · News · Termine · Meldungen · Kontrollen · Integrationen · Postausgang · Einstellungen · Datenschutz & Löschung · Protokoll.

## 4.7 Projektstruktur

```
fvw-fangbuch/
├── app/                 Expo-App (src/app = Bildschirme, src/lib = Daten/Sync/Karte, src/components)
├── backend/             API, Admin-Web (admin-web/), Migrationen, Integrationsadapter, Jobs, Tests
├── packages/shared/     Gemeinsame Fachlogik (KML-Import, Regeln, Geometrie, CSV, Sync-Typen) + Tests
├── data/source/2026/    Quelldaten (KMZ-Netzwerklinks, Live-Abruf-KML mit Prüfsummen, Anforderungsdokument)
├── data/derived/2026/   Abgeleitete Kartendaten (für die App mitgeliefert) und Importbefunde
├── data/basemap/        Offline-Kartenpakete (MBTiles) + Manifest
├── tools/               Import-Bericht, Basiskarten-Generator, Entwicklungs-Hilfen
├── e2e/                 End-to-End-Tests (App) und Rauchtest (Admin-Web)
└── docs/                Diese Dokumentation, Screenshots
```
