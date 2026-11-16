# 1 Anforderungen – Fangbuch- und Patent-App FV Werdenberg, Saison 2026

Quellen:

- **AD** = Anforderungsdokument «Anforderungen Fangbuch- und Patent-App – Fischereiverein Werdenberg», 8. November 2026 (Abschnitt in Klammern, z. B. AD §1)
- **PA** = Projektauftrag (verbindlicher Auftragstext, Abschnitt in Klammern)
- **KML** = Kartendaten der drei My-Maps-Karten (siehe [02-importbericht.md](02-importbericht.md))

Status:

- **beschlossen**: Im AD als «festgelegt» oder «entschieden» bezeichnet oder im PA verbindlich verlangt. Wird als Produktanforderung umgesetzt.
- **Vorschlag**: Im AD oder PA als Vorschlag oder Diskussionsgrundlage bezeichnet. Wird konfigurierbar oder demonstrativ umgesetzt und in der App als «Vorschlag» gekennzeichnet.
- **offen**: Der Vorstand muss entscheiden. Es werden keine Werte erfunden. Der Punkt erscheint in der Adminoberfläche unter «Offene Entscheide» und in [03-offene-entscheidungen.md](03-offene-entscheidungen.md).

Die Spalte «Umsetzung» verweist auf die betroffene App-Funktion: **App** für die Mobile App, **BE** für das Backend, **Admin** für den Adminbereich.

## A Fangbuch (Kernbereich, laut AD §1 «bereits festgelegt»)

| # | Anforderung | Status | Quelle | Umsetzung | Offene Abhängigkeit |
|---|---|---|---|---|---|
| A1 | Gewässer vor Tourstart aus einer Liste wählen | beschlossen | AD §1, PA §5 | App: Tour → Gewässerwahl | – |
| A2 | Gewässer anhand des Standorts vorschlagen, manuell änderbar | beschlossen | AD §1 Karten, PA §5/§7 | App: Tour → «Vorschlag aus Standort» | Standortfreigabe durch Person |
| A3 | Fehlende Gewässer ergänzen; neue Einträge «ungeprüft», gelten erst nach Vorstandsbestätigung für alle | beschlossen | AD §1, PA §5 | App: Tour → «Gewässer fehlt»; Admin: Gewässer → Prüfen | – |
| A4 | Start: Datum und Uhrzeit automatisch erfassen; Dauer mitführen | beschlossen | AD §1, PA §5 | App: Tour (Timer) | – |
| A5 | Stop nur mit Bestätigung | beschlossen | AD §1, PA §5 | App: Tour → Stop-Dialog | – |
| A6 | Abschluss als Fangmeldung oder «Kein Fang / Nullmeldung»; Nullmeldung zählt als Rückmeldung | beschlossen | AD §5, PA §5/§13 | App: Tour-Abschluss | – |
| A7 | Fang nur während laufender Tour | beschlossen | AD §1, PA §5 | App + BE-Validierung | – |
| A8 | Fischarten: Bachforelle, Regenbogenforelle, Äsche, Alet, Barbe, Groppe, Karpfen, Hecht, Nase | beschlossen | AD §1, PA §5 | App, Admin: Fischarten pflegbar | – |
| A9 | Länge in cm, Verbleib entnommen/zurückgesetzt, Zeitpunkt automatisch | beschlossen | AD §1, PA §5 | App: Fangerfassung | Mindestmasse sind **nicht** vorgegeben, siehe O19 |
| A10 | Mehrere Fänge pro Tour; offline bearbeitbar; nach Abschluss Änderungen protokolliert | beschlossen | PA §5 | App + BE: Revisionsprotokoll | – |
| A11 | Fangliste mit Filter; Mitglied sieht nur eigene Fänge | beschlossen | AD §1, PA §3/§5 | App: Fangbuch; BE prüft Eigentum | – |
| A12 | Admin kann zwischen «nur meine» und «alle Mitglieder» wechseln | beschlossen | AD §1, PA §5 | App/Admin: Fangbuch | – |
| A13 | Aufseher ohne vereinsweite Fangliste (ausser ausdrücklich erteilt) | beschlossen | PA §5 | BE-Berechtigung `catches.read_all` | – |
| A14 | CSV-Export `Datum, Uhrzeit, Mitglied, Gewässer, Art, Länge, Entnommen`, Umlaute korrekt | beschlossen | AD §1, PA §5 | App + BE: CSV (UTF-8 mit BOM, Semikolon) | – |
| A15 | Gastdaten in Fanglisten nach Frist anonymisieren | beschlossen (Frist offen) | AD §4, PA §5/§14 | BE-Job «Gastdaten-Frist» | Frist: O12 |

## B Offline-Betrieb und Synchronisation

| # | Anforderung | Status | Quelle | Umsetzung | Offene Abhängigkeit |
|---|---|---|---|---|---|
| B1 | Echte App für Android und iOS mit Backend, keine reine Web-App | beschlossen | AD §3 «Entschieden», PA §17 | Expo/React Native + Node-Backend | Technologiewahl ist im AD §6 noch offen; Begründung in [04-architektur.md](04-architektur.md) |
| B2 | Vollständig offline: Tour, Fänge, Nullmeldungen, Karte mit Standort, Patent vorweisen, Kontrolle | beschlossen | AD §3, PA §6 | App: lokale SQLite-Datenbank | – |
| B3 | Kein Datenverlust bei Absturz, Neustart oder leerem Akku | beschlossen | AD §3, PA §6 | App: jede Eingabe sofort in SQLite (WAL) | – |
| B4 | Automatische Synchronisation; keine Duplikate; Konflikte nachvollziehbar | beschlossen | AD §1/§3, PA §6 | Outbox mit Client-UUID, Server-Upsert, Revisionen | – |
| B5 | Ausstehende Uploads und Fehler sichtbar; Sync-Zeit und Kartenstand sichtbar | beschlossen | AD §3, PA §6 | App: Statusleiste, Profil → Synchronisation | – |
| B6 | Lokale Daten verschlüsselt, soweit die Plattform das unterstützt | beschlossen | PA §6/§14 | SQLCipher (Expo-Build), Schlüssel im Keychain/Keystore | In Expo Go nicht verfügbar (wird angezeigt) |
| B7 | Anmeldung offline gültig innerhalb der Sitzung | beschlossen | AD §3, PA §4/§6 | Sitzungstoken + Profil lokal | Sitzungsdauer: O9 |

## C Gewässerkarten, Standort, Regeln

| # | Anforderung | Status | Quelle | Umsetzung | Offene Abhängigkeit |
|---|---|---|---|---|---|
| C1 | Karte passend zu Patent, Jugendberechtigung oder Tageskarte; umschaltbar | beschlossen | AD §1, PA §7 | App: Karte → Kartenwahl | Patentarten: O1 |
| C2 | Standortpunkt nur nach OS-Freigabe **und** Zustimmung; Karte funktioniert ohne | beschlossen | AD §1, PA §7/§14 | App: Standort standardmässig aus | – |
| C3 | Warnung ausserhalb erlaubter Gewässer und in gesperrten Bereichen; GPS nur als Orientierung | beschlossen | AD §1, PA §7 | App: Lagehinweis | – |
| C4 | Antippen eines Abschnitts: Name, Code, Köder, Regeln, Sperren, Zustand | beschlossen | AD §1, PA §7 | App: Abschnittsdetails | – |
| C5 | Regeln pro Abschnitt/Geometrie, nicht pro Gewässername | beschlossen | AD §1, PA §2 | Datenmodell `water_section` | – |
| C6 | Ebene → Köderregel; Beschreibung → Code und Regeltext; Geometrie → Darstellung und Lageprüfung | beschlossen | AD §1, PA §2 | Importer | – |
| C7 | Ebene «Nur Kunstköder …»: Bedeutung unklar → «Vorstandsklärung erforderlich» | offen | AD §1/§6, PA §2 | App + Admin: Regelstatus `unklar` | O8 |
| C8 | Voralpsee: eigene Regeln, nur bestätigte Angaben | beschlossen (Inhalt offen) | AD §1, PA §2 | Regeltext aus Import, Status «nur importierter Text» | O20 |
| C9 | Gesperrte Gewässer: Fischen verboten, deutliche Warnung | beschlossen | AD §1, PA §2 | App: rote Darstellung + Warnung | – |
| C10 | Pachtgrenze: Darstellung und Lageprüfung | beschlossen | AD §1, PA §2 | App: Linie, Hinweis | – |
| C11 | Grenze Berg-/Talgewässer: nur darstellen, keine Rechtsfolgen ableiten | beschlossen | AD §1, PA §2 | App: Linie, ohne Regel | O21 |
| C12 | Zeitliche Sperren als strukturierte Felder (von/bis); Freitext **nicht** automatisch umdeuten | beschlossen (Pflegeweg offen) | AD §1/§6, PA §7 | Admin: Sperrzeiten; Importbericht listet Freitext-Kandidaten | O10 |
| C13 | Kein Standortverlauf; höchstens Gewässer der Tour speichern | beschlossen | AD §1, PA §7/§14 | App speichert keine Koordinaten in Touren | – |
| C14 | Offline-Karte: Geometrien, Regeln und Kartenausschnitt lokal; Anbieter mit Offline-Recht | beschlossen | AD §1, PA §7 | swisstopo LK25 über Downloadservice als MBTiles | Lizenz vom Verein bestätigen: O22 |
| C15 | Vereinslokal/Fischerheim als Orientierungspunkt | beschlossen | AD §1, PA §2 | App: Kartenpunkt | Namensvariante: Importbericht |

## D Kartenaktualisierung im Backend

| # | Anforderung | Status | Quelle | Umsetzung | Offene Abhängigkeit |
|---|---|---|---|---|---|
| D1 | Geprüfte KML-Basis versioniert speichern und mit App ausliefern | beschlossen | AD §1, PA §8 | BE: `map_version`; App: gebündelte Version | Die geprüften KML-Exporte fehlen; vorläufig Live-Abruf, siehe Importbericht |
| D2 | Täglicher Abruf der Netzwerklinks; Prüfsummenvergleich; bei Gleichheit nichts tun | beschlossen | AD §1, PA §8 | BE-Job `map-check` (täglich) | My-Maps-Freigabe «Jeder mit dem Link» (am 15.11.2026 gegeben) |
| D3 | Bei Abweichung neue Version speichern, Vorstand informieren, App zeigt «Gewässerkarte aktualisiert am …» | beschlossen | AD §1, PA §8 | BE + Admin-Freigabe + App-Hinweis | – |
| D4 | Fehlerfall: letzte Version bleibt gültig, Admin erhält Fehlermeldung | beschlossen | AD §1, PA §8 | BE: Integrationsprotokoll | – |
| D5 | Jahreswechsel ohne App-Neubau (neue KML, Links, Saison) | beschlossen | AD §1, PA §8 | Admin: Saisons und Kartenquellen | – |
| D6 | Vorschau und Importbericht vor Aktivierung; Rückkehr zur letzten gültigen Version | beschlossen | PA §16 | Admin: Kartenversionen | – |

## E Rollen, Anmeldung, Mitgliederdaten

| # | Anforderung | Status | Quelle | Umsetzung | Offene Abhängigkeit |
|---|---|---|---|---|---|
| E1 | Rollen Mitglied, Aufseher, Vorstand/Admin; Gastzugang für Tageskarten | beschlossen | AD §3, PA §3 | BE: Rollen + Berechtigungen | – |
| E2 | Berechtigungen serverseitig prüfen | beschlossen | PA §3/§14 | BE-Middleware | – |
| E3 | Rollen aus Fairgate-Gruppe **oder** in der App gepflegt (konfigurierbar) | Vorschlag | AD §4, PA §3 | Admin: Einstellung «Rollenquelle» | O23 |
| E4 | Fairgate bleibt führende Quelle der Mitgliederdaten; keine eigene Kartei | beschlossen | AD §4, PA §4 | BE: Fairgate-Adapter (nur lesend) | FSA gebucht? O7 |
| E5 | Login per E-Mail-Einmalcode, nur für berechtigte Fairgate-Einträge | Vorschlag | AD §4, PA §4 | BE: Better Auth (E-Mail-OTP) + Berechtigungsprüfung | O7, O17 |
| E6 | Keine eigenen Passwörter; etablierter Auth-Dienst | beschlossen | AD §4, PA §4 | Better Auth (Open Source, selbst gehostet) | – |
| E7 | FSA-Token nur im Backend | beschlossen | AD §4, PA §4/§14 | BE-Konfiguration | – |
| E8 | Ersatzweg ohne E-Mail (SMS-Code oder Vorstands-Zugang) | Vorschlag | AD §4, PA §4 | Admin: Einmal-Zugangscode erstellen; SMS nicht eingerichtet | O17 |
| E9 | Austritt/Sperre → Zugriff nach nächstem Abgleich entzogen | beschlossen | AD §4, PA §4 | BE: Fairgate-Abgleich widerruft Sitzungen | – |
| E10 | Tageskartenkäufer: Prüfung Fairgate → Eventfrog-Bestellung; Code an Bestell-E-Mail; optional Ticketnummer | Vorschlag | AD §4, PA §4 | BE: Eventfrog-Adapter | O11 |
| E11 | Gastzugang = Gültigkeit + Nachmeldefrist; mehrere Käufe → ein Gastkonto | Vorschlag | AD §4, PA §4 | BE: `guest_account` | Frist: O12 |

## F Patente und Tageskarten (laut AD §2 «Vorschlag», nicht beschlossen)

| # | Anforderung | Status | Quelle | Umsetzung | Offene Abhängigkeit |
|---|---|---|---|---|---|
| F1 | Patentarten (z. B. Jahrespatent aktive Fischer, Jugendfischer, Tageskarten Voralpsee/Binnenkanal, Spezialkarten wie Äschenkarte) | Vorschlag | AD §2 | Admin: Patentarten frei anlegbar; **keine Preise** | O1 |
| F2 | Gültigkeitszeitraum und erlaubte Gewässer pro Patent | Vorschlag | AD §2 | Patentart → Kartengruppe | O1 |
| F3 | Patent/Tageskarte im Handy vorweisen, z. B. mit QR-Code | Vorschlag | AD §2, PA §6 | App: Patent-Ausweis (offline) | – |
| F4 | Hinweis bei Ablauf oder fehlendem Patent | Vorschlag | AD §2 | App: Dashboard | – |
| F5 | Tour nur an Gewässern mit gültigem Patent | Vorschlag | AD §2 | App: Hinweis (konfigurierbar: Hinweis oder Sperre; Standard: Hinweis) | O1 |
| F6 | Vorstand: Patente ausstellen, verlängern, sperren; Zahlungsstatus | Vorschlag | AD §2 | Admin: Patente (Zahlungsstatus als freies Statusfeld, keine Zahlung in der App) | O2 |
| F7 | Verkauf/Bezahlung in der App | offen | AD §6 | nicht umgesetzt | O2 |
| F8 | Jeder Fang einem Patent zugeordnet; Saisonauswertung; Export für Kanton | Vorschlag (Format offen) | AD §2/§6 | Tour speichert Patent-ID; Kantonsformat nicht umgesetzt | O4 |
| F9 | Mitgliederliste mit Status aktiv, Freimitglied, Ehrenmitglied, Warteliste | Vorschlag | AD §2/§4 | Statuswerte aus Fairgate übernommen, nicht in App gepflegt | O7 |

## G Kontrollen durch Aufseher

| # | Anforderung | Status | Quelle | Umsetzung | Offene Abhängigkeit |
|---|---|---|---|---|---|
| G1 | Kontrollfunktion für Aufseher (eigene Rolle) | beschlossen | AD §2 «Entschieden», PA §12 | App: Kontrolle | – |
| G2 | Kontrolle offline, später synchronisieren | beschlossen | AD §2, PA §12 | App-Outbox | – |
| G3 | Aufseher prüft Patent/Tageskarte in der App des Fischers | beschlossen | AD §2 | App: QR-Code des Ausweises scannen oder manuell erfassen | – |
| G4 | Unterzeichnung durch Aufseher (QR, PIN, Unterschrift) | offen | AD §2/§6, PA §12 | Konfigurierbar: keine / PIN / Unterschrift / QR; Standard «nicht festgelegt» | O3 |
| G5 | Vermerk mit Datum, Uhrzeit, Gewässer, Aufseher bei Tour bzw. im Fangbuch | beschlossen | AD §2 | Kontrolle verknüpft mit Tour-ID, falls vorhanden | – |
| G6 | Vergehen melden: Vorname, Nachname, Beschreibung, Fotos; Pflichtfelder konfigurierbar | beschlossen (Pflichtfelder offen) | PA §12 | App + Admin | O24 |
| G7 | Kontrolldaten restriktiv, revisionsfähig, Aufbewahrung nach Vereinsvorgabe | beschlossen (Frist offen) | PA §12/§14 | BE: nur Admin + erfassender Aufseher | O25 |
| G8 | Kein automatischer Versand an Behörden | beschlossen | PA §12 | nicht vorhanden | – |
| G9 | Vorstand sieht Übersicht der Kontrollen | beschlossen | AD §2 | Admin: Kontrollen | – |

## H Fangmeldung und Rücklaufquote

| # | Anforderung | Status | Quelle | Umsetzung | Offene Abhängigkeit |
|---|---|---|---|---|---|
| H1 | «Fangmeldung offen» pro Tageskarte bzw. Fischtag | beschlossen | AD §5, PA §13 | App: Dashboard; BE: Status | – |
| H2 | Erinnerung am Abend (Push) und am Folgetag (E-Mail); Mitglieder vor Saisonende | Vorschlag (optional) | AD §5, PA §13 | BE-Job, standardmässig **aus** | Push/E-Mail nicht eingerichtet |
| H3 | Rücklaufquote: Tageskarten mit Meldung ÷ verkaufte Tageskarten; Mitglieder mit Saisonmeldung ÷ Patente; pro Patentart und Saison | beschlossen | AD §5, PA §13 | Admin: Rücklauf | Saisondefinition: O26 |
| H4 | Fehlende Meldungen markieren | beschlossen | AD §5, PA §13 | Admin: Rücklauf | – |
| H5 | Folgen fehlender Meldungen | offen | AD §5/§6, PA §13 | **keine Sanktion umgesetzt** | O15 |

## I News, Gewässerzustand, Termine, Meldungen, Standort teilen

| # | Anforderung | Status | Quelle | Umsetzung | Offene Abhängigkeit |
|---|---|---|---|---|---|
| I1 | News: Titel, Text, Datum, Foto, Kategorie, Ablaufdatum; Sichtbarkeit alle/nur Mitglieder | beschlossen | AD §5, PA §9 | App + Admin | Wer darf erfassen: O14 |
| I2 | Gewässerzustand mit Gewässerbezug (Wasserstand, Trübung, Eis, Sperrung); auf Karte sichtbar; abgelaufen gekennzeichnet | beschlossen | AD §5, PA §9 | App: Karte + News | – |
| I3 | Push bei wichtigen Meldungen | Vorschlag (optional) | AD §5, PA §9 | Push-Adapter (nicht eingerichtet) | – |
| I4 | Termine der Vereinswebseite, Kalenderexport, bevorzugt iCal/RSS, sonst Seite auslesen | beschlossen | AD §5, PA §10 | BE: Website-Adapter; App: «In Kalender» (.ics) | Feed vorhanden? O13 |
| I5 | Anmeldung zu Termin per Button an konfigurierbare Adresse (Start: harald.goeldi@gmail.com) | beschlossen | PA §10 | BE: Mail-Adapter (Entwurfsmodus) | – |
| I6 | Meldung Verschmutzung/tote Fische mit Beschreibung, Gewässer, Standort (Einwilligung), Fotos, Zeit, Übermittlungsstatus; Adresse konfigurierbar (Start: harald.goeldi@gmail.com) | beschlossen | PA §11 | App + BE | – |
| I7 | Standort als Link teilen (Messenger/SMS/E-Mail) | beschlossen (einfache Variante) | AD §5, PA §14 | App: Teilen-Dialog des Systems | – |
| I8 | Live-Standort mit ausgewählten Personen | Vorschlag, später | AD §5/§6, PA §14 | als deaktivierte Funktion vorgesehen | O16 |

## J Datenschutz, Sicherheit, Betrieb

| # | Anforderung | Status | Quelle | Umsetzung | Offene Abhängigkeit |
|---|---|---|---|---|---|
| J1 | nDSG, Datenminimierung, verschlüsselte Übertragung | beschlossen | AD §3, PA §14 | HTTPS (Betrieb), minimale Felder | Hosting: O27 |
| J2 | Zugangsdaten Dritter nur im Backend | beschlossen | PA §14/§17 | `.env` im Backend; App ohne Geheimnisse | – |
| J3 | Standort standardmässig aus; Zweckhinweise vor Berechtigungen | beschlossen | PA §14 | App: Hinweisdialoge | – |
| J4 | Datenexport und Kontolöschung bzw. administrativer Löschprozess | beschlossen | PA §14 | App: Profil → Meine Daten; Admin: Löschanträge | Aufbewahrungsfristen: O25 |
| J5 | Audit-Log für Adminaktionen, Importe, Regel- und Berechtigungsänderungen | beschlossen | PA §14/§16 | BE: `audit_log` | – |
| J6 | Adminpflege ohne Programmierkenntnisse; versioniert; Vorschau; Rückkehr | beschlossen | AD §3, PA §16 | Admin-Weboberfläche | – |
| J7 | Getrennte Test- und Produktivkonfiguration | beschlossen | PA §17 | `NODE_ENV`/`.env.test`/`.env.production`, getrennte DB | – |
| J8 | Integrationsstatus pro Adapter (nicht eingerichtet, Testmodus, aktiv, Fehler); Mock-Modus; Retry; Fehlerprotokoll | beschlossen | PA §18 | BE + Admin: Integrationen | – |
| J9 | Gestaltung: Logo unverändert, hoher Kontrast, grosse Touchflächen, Textlabels, vergrösserbare Schrift | beschlossen | AD §3, PA §15 | App-Designsystem | **Logo-Datei fehlt**, siehe [08-annahmen.md](08-annahmen.md) |
