# 9 Prüfung der Akzeptanzkriterien (PA §19)

Prüfstand: 15.11.2026.

Automatisierte Nachweise:

- **24** Tests der gemeinsamen Fachlogik (`packages/shared`)
- **28** Backend-Integrationstests gegen PostgreSQL (`backend/test`)
- **11** End-to-End-Abläufe der App (`e2e/app.e2e.mjs`), zweimal hintereinander fehlerfrei
- Rauchtest der Admin-Weboberfläche: 21 Ansichten ohne JavaScript-Fehler (`e2e/admin-web.smoke.cjs`)
- Typprüfung aller Pakete fehlerfrei

Screenshots liegen in `docs/screenshots/`.

> **Allgemeiner Vorbehalt:** Die App-Abläufe wurden in der **Web-Vorschau derselben Codebasis** getestet, denn in der Entwicklungsumgebung gab es weder Android-SDK noch iOS-Simulator. Die nativen Bundles (Android und iOS) werden erzeugt, und `expo prebuild` läuft durch. Ein Test auf echten Geräten steht aus. Er ist die erste Aufgabe vor einem Pilotbetrieb.

| # | Kriterium | Ergebnis | Nachweis | Bemerkung |
|---|---|---|---|---|
| 1 | Mitglied kann sich im Demo-Modus anmelden und den Offline-Status sehen | **erfüllt** | E2E «1/5 Mitglied …»; Screenshots `01-start-online`, `02-start-offline` | Anmeldung per Einmal-Code (Demo-Code sichtbar). Die Offline-Anzeige erscheint in jeder Kopfzeile und auf dem Startbildschirm. |
| 2 | Tageskartenperson kann im Demo-Modus eine gültige Kartenberechtigung vorweisen | **erfüllt** | E2E «2 Tageskarte …» (offline); Backend-Test «Gast mit gültiger Tageskarte …»; Screenshot `09-tageskarte-ausweis-offline` | Der signierte QR-Ausweis (Ed25519) wird offline angezeigt. Der Aufseher prüft ihn offline (Kriterium 14). |
| 3 | Passende Karte wird anhand der Berechtigung angezeigt und kann bei mehreren Berechtigungen gewechselt werden | **erfüllt** | E2E «3/4 Karte …»; Backend-Tests (Gast nur Tageskarte, Mitglied mit zwei Patenten); Screenshot `05-karte-aktive` | Gäste sehen ausschliesslich die Tageskarte (serverseitig, 403 sonst). |
| 4 | Karte funktioniert ohne Netz mit zuvor geladenen Gewässerdaten | **erfüllt** | E2E «3/4 Karte …» (Neuladen ohne Server) | Gewässerdaten und Regeln liegen lokal. Die Kartenkacheln liegen nativ als MBTiles in der App (5 MB) und können optional zu 35 MB ergänzt werden. In der Web-Vorschau werden die Kacheln online geladen. |
| 5 | Standort ist standardmässig aus; Karte funktioniert trotzdem | **erfüllt** | E2E «1/5 …» (Knopf «Standort anzeigen», keine Abfrage) und «10 Warnungen …» (erst nach «Zustimmen») | Es gibt einen Zweckhinweis vor der Systemabfrage. Es wird kein Standortverlauf gespeichert. |
| 6 | Tour kann gestartet, mit Fängen ergänzt, pausiert/beendet und als Nullmeldung abgeschlossen werden | **erfüllt** | E2E «6/7 Tour …» (Pause/Weiter, Stop mit Bestätigung) und «6 Nullmeldung …»; Screenshot `04-tour-stop-bestaetigung` | Datum und Uhrzeit werden automatisch erfasst. Die Fischzeit zählt ohne Pausen. |
| 7 | Fangerfassung funktioniert offline, übersteht App-Neustart und wird später ohne Duplikate synchronisiert | **erfüllt** (Gerätetest ausstehend) | E2E «6/7 Tour …»: Fang offline erfasst, Neustart ohne Server, beide Fänge vorhanden, nach Wiederverbindung **genau 2** Fänge auf dem Server; Backend-Test «idempotent (Wiederholung ohne Duplikate)»; Screenshot `03-tour-offline` | Jede Eingabe wird sofort transaktional gespeichert (SQLite WAL, `synchronous=FULL`). Der Idempotenzschlüssel pro Operation verhindert Duplikate. |
| 8 | Fangliste zeigt Mitgliedern nur eigene Einträge; Admin kann alle Einträge filtern | **erfüllt** | Backend-Test «Mitglied sieht nur eigene Fänge …» (403 für Mitglied und Aufseher bei «alle»); E2E «8/9 Fangliste …»; Screenshots `07`, `08` | Filter nach Zeitraum und Art in der App, nach Datum und Art im Admin. |
| 9 | CSV enthält die geforderten Spalten und ist lesbar | **erfüllt** | Shared-Test «CSV …»; Backend-Test «CSV …»; E2E (Download geprüft) | `Datum;Uhrzeit;Mitglied;Gewässer;Art;Länge;Entnommen`, UTF-8 mit BOM, Semikolon, CRLF, Schutz vor Formel-Injektion, Schweizer Ortszeit. |
| 10 | Gesperrte Bereiche erzeugen eine deutliche Warnung; unklare Köderregeln werden als ungeklärt markiert | **erfüllt** | E2E «10 Warnungen …» (Standort auf gesperrtem Abschnitt bzw. «Nur Kunstköder»); Shared-Tests; Screenshot `06-karte-gesperrt-warnung` | Die Warnung trägt den Hinweis «GPS ist nur eine ungefähre Orientierung, kein verbindlicher Rechtsnachweis». Der Widerspruch Buchser Giessen wird vorsorglich als Sperrung gezeigt. |
| 11 | Admin sieht Kartenimport, Prüfsumme, Versionsstand, Datenqualitätsprobleme und Fehlerzustand | **erfüllt** | Backend-Tests «tägliche Prüfung …», «Fehler beim Abruf …», «Normalisierung nur nach Admin-Bestätigung»; Admin-Screenshots `admin-karten`, `admin-version`, `admin-befunde`, `admin-uebersicht` | Vorschau, Unterschiede zur aktiven Version, Aktivieren, Ablehnen und Rückkehr zur letzten gültigen Version sind vorhanden. |
| 12 | News, Gewässerzustand und Termine können im Demo-Modus erstellt und angezeigt werden | **erfüllt** | E2E «12 News …» (Admin erfasst Gewässerzustand in der App, Mitglied sieht ihn; abgelaufene Meldung gekennzeichnet; Termin mit Anmeldung); Backend-Test News/Termine; Screenshots `10`, `11` | Termine kommen absichtlich nicht aus einer Erfassungsmaske, sondern aus dem (Demo-)Feed der Vereinswebseite, damit nichts doppelt gepflegt wird. |
| 13 | Meldung zu Verschmutzung kann offline erstellt und mit ausstehendem Versandstatus angezeigt werden | **erfüllt** | E2E «13 Meldung …»; Backend-Test (idempotent, Entwurf an harald.goeldi@gmail.com); Screenshot `12-meldung-offline-ausstehend` | Nach dem Sync lautet der Status «Übermittelt (E-Mail im Entwurfsmodus, nicht versendet)». |
| 14 | Aufseher kann eine Kontrolle offline dokumentieren und synchronisieren | **erfüllt** | E2E «14 Aufseher …» (Ausweis offline gültig, manipulierter Ausweis «Signatur ungültig», Sync, im Admin sichtbar); Backend-Test Kontrolle; Screenshot `13-kontrolle-offline-gueltig` | Die Bestätigungsart ist «nicht festgelegt» (O3); PIN und Unterschrift sind als Vorschlag umschaltbar. Abgeschlossene Kontrollen sind unveränderlich. |
| 15 | Unberechtigte Rollen können fremde Fang- und Kontrolldaten nicht abrufen | **erfüllt** | Backend-Tests: «alle»-Fangliste und CSV (403), fremde Datensätze überschreiben bzw. wiederholen (abgelehnt), Kontrollen für Mitglied (abgelehnt), Admin-Kontrollen für Aufseher (403), Adminbereich für Mitglied und Aufseher (403) | Die Prüfung erfolgt im Backend, nicht durch Ausblenden in der App. |
| 16 | Keine Daten oder Regeln werden durch erfundene Werte ergänzt | **erfüllt** | Einstellungen ohne Beschluss stehen auf «nicht festgelegt» (Admin → Einstellungen); keine Preise, Fristen, Mindestmasse oder Sanktionen; Demo-Daten sind als «Demo» bzw. `.invalid` gekennzeichnet; Shared-Test «ändert ohne Admin-Bestätigung keine Werte» | Technische Parameter (Längenplausibilität 1–150 cm, GPS-Toleranz 50 m, Sitzungsdauer 180 Tage) sind als solche ausgewiesen ([08-annahmen.md](08-annahmen.md)). |
| 17 | Nicht verfügbare Integrationen und offene Vorstandsentscheidungen sind in App und Dokumentation klar ausgewiesen | **erfüllt** | E2E «17 Offene Entscheide …»; Screenshot `14-status-entscheide-integrationen`; Admin «Offene Entscheide» und «Integrationen»; [03-offene-entscheidungen.md](03-offene-entscheidungen.md), [07-integrationen.md](07-integrationen.md) | 31 offene Punkte, Integrationsstatus «nicht eingerichtet / Testmodus / aktiv / Fehler». |

## Was vor einem Pilotbetrieb noch fehlt (nicht Teil der Akzeptanzkriterien)

1. Gerätetests auf iOS und Android (Release-Build mit SQLCipher), insbesondere Offline-Karte, Kamera/QR, Neustart bei leerem Akku.
2. Vereinslogo einbauen.
3. Geprüfte KML-Exporte importieren und als Basis bestätigen.
4. Vorstandsentscheide O1–O31 fällen, mindestens O3, O8, O12, O25 und O27.
5. Integrationen einrichten (FSA, Eventfrog, SMTP, Termin-Feed), mit den echten Endpunkten verifizieren und die Testfälle mit echten Testdaten wiederholen.
