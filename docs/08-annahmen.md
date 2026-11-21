# 8 Annahmen, Abweichungen und nicht verfügbare Elemente

## 8.1 Quelldaten

| Thema | Sachlage | Umgang |
|---|---|---|
| KMZ-Dateien | Alle drei enthalten **nur einen Netzwerklink**, keine Kartendaten. | Gekennzeichnet (Importbericht, Admin). Der Import lehnt reine Netzwerklink-Dateien mit Erklärung ab. |
| Geprüfte KML-Basisdateien | **Nicht geliefert.** | Die Daten wurden am 15.11.2026 über die Netzwerklinks abgerufen. Grössen (760/219/20 KB) und Objektzahlen stimmen mit dem AD überein. Die Versionen sind aktiv, aber **als «nicht geprüfte Basis»** markiert. |
| Vereinslogo `logo-transparent.png` | **Geliefert am 21.11.2026.** | In der App eingebaut (Kopfzeile und Anmeldung, `app/assets/logo-transparent.png`, nur der leere transparente Rand entfernt). Admin-Oberfläche zeigt noch den Platzhalter «FVW». |
| Web-Prototyp «Fangbuch – Fischereiverein» | Im AD verlinkt, gelesen. | Fischarten, Längengrenze (1–150 cm, technisch) und Farbschema übernommen. |

## 8.2 Fachliche Annahmen (alle konfigurierbar oder als offen markiert)

| # | Annahme | Begründung | Änderbar |
|---|---|---|---|
| A1 | Längenprüfung 1–150 cm, ganzzahlig, ist **kein Mindestmass** | Aus dem bestehenden Web-Prototyp; reine Plausibilität | Code (`LENGTH_CM_MIN/MAX`) |
| A2 | Lagehinweis-Toleranz 50 m (bzw. GPS-Genauigkeit, max. 300 m) | Linien sind Gewässerachsen; technischer Parameter, keine Vereinsregel | Admin → Einstellungen |
| A3 | Sitzungsdauer 180 Tage | Mitte des AD-Beispiels «6–12 Monate» (O9) | `SESSION_DAYS` |
| A4 | Login nur mit Fairgate-Status «aktiv» | AD §4: «aktives Mitglied» (O31) | Admin → Einstellungen |
| A5 | Ohne festgelegte Nachmeldefrist endet der Gastzugang mit der Kartengültigkeit | Keine Frist erfinden (O12) | Admin → Einstellungen |
| A6 | Ohne festgelegte Löschfristen wird nichts automatisch gelöscht | Keine Frist erfinden (O12/O25) | Admin → Einstellungen |
| A7 | Ohne Patent sehen Mitglieder alle Karten «zur Information»; Tourstart zeigt nur einen Hinweis | Eine Sperre wäre eine Sanktion ohne Beschluss (O30) | Admin → Einstellungen |
| A8 | Saison = Kalenderjahr, solange Beginn/Ende fehlen | Als Annahme in der Rücklaufquote angezeigt (O26) | Admin → Einstellungen → Saisons |
| A9 | «Saisonmeldung: nicht gefischt» für Mitglieder | Nötig, damit «Mitglieder mit Saisonmeldung ÷ Patente» auch Nicht-Fischende erfasst; als Vorschlag gekennzeichnet | – |
| A10 | Buchser Giessen («gesperrt!» in Köderebene) wird **vorsorglich als gesperrt** gewarnt und als Widerspruch markiert | Sicherheit vor Bequemlichkeit (O28) | Admin → Importbefunde / Vorstand |
| A11 | «Nur Kunstköder» wird **nicht ausgelegt** (Fischen erlaubt = offen) | AD §6 | Admin → Köderregeln nach Entscheid |
| A12 | Voralpsee: nur der importierte Text («Natur- & Kunstköder, Löffel, Wobbler & Spinner erlaubt.») | «Eigene Regeln» sind unbekannt (O20) | Admin → Köderregeln |
| A13 | Konfliktregel: Gerätestand gewinnt gegen eigenen älteren Stand, nicht gegen Admin-Änderungen | Nachvollziehbar, nichts geht verloren | Code |
| A14 | Demo-Patentarten (aktive Fischer, Jugend, Tageskarte Binnenkanal) | Nur zur Vorführung, als «Demo» markiert, ohne Preise und Bedingungen (O1) | Admin → Patentarten |
| A15 | Aufseher sehen alle drei Karten | Kontrollen an allen Pachtgewässern | Rollenmatrix |
| A16 | Vorstand erhält Kartenänderungs- und Fehlerhinweise nur im Adminbereich, solange `recipients.admin_alerts` leer ist | Keine Adresse erfinden | Admin → Einstellungen |

## 8.3 Nicht verfügbare Integrationen (Stand 15.11.2026)

Fairgate FSA, Eventfrog Organizer API, E-Mail-Versand (SMTP), Push und Vereinswebseiten-Feed laufen nur im Demo- bzw. Entwurfsmodus. SMS ist nicht umgesetzt. Details und Voraussetzungen stehen in [07-integrationen.md](07-integrationen.md).

## 8.4 Technische Grenzen des Prototyps

- **Native Builds:** In der Entwicklungsumgebung gab es weder Android-SDK noch iOS-Simulator. Geprüft wurden: TypeScript-Typprüfung, Metro-Bundling für Android und iOS (Hermes-Bytecode inkl. Offline-Kartenpaket), `expo prebuild` für Android (SQLCipher-Flag, Berechtigungen) und alle Abläufe in der **Web-Vorschau** derselben Codebasis (11 End-to-End-Tests). Ein Test auf echten Geräten (iOS und Android) steht noch aus.
- **Web-Vorschau ≠ App:** Im Browser ist die lokale Datenbank nicht verschlüsselt, Kartenkacheln werden online geladen, und die Kamera-/Fotofunktionen hängen vom Browser ab.
- **SQLCipher in Expo Go:** nicht verfügbar. Die App zeigt das unter Profil an. Verschlüsselung gibt es nur im Development- oder Release-Build.
- **Fotos in My-Maps-Beschreibungen:** nur online (Google-Server).
- **Live-Standort teilen:** bewusst deaktiviert (O16). Nur die Link-Variante ist umgesetzt.
- **Kantonsstatistik:** kein Format umgesetzt (O4).
- **Erinnerungen** (Abend-Push, E-Mail am Folgetag, vor Saisonende): Einstellungen sind vorhanden, der Versand ist erst mit eingerichtetem Push/E-Mail sinnvoll und standardmässig aus.
