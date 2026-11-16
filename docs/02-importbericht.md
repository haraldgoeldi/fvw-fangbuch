# 2 Importbericht Gewässerkarten 2026

Erstellt: 2026-11-15 18:55 UTC · Quelle: Live-Abruf der My-Maps-Netzwerklinks am 15.11.2026 (siehe data/source/2026/kml-live-abruf/ABRUF.md)

**Status der Daten:** Live-Abruf, **noch nicht als geprüfte Basisversion bestätigt** (die vollständigen KML-Exporte wurden nicht mitgeliefert; die drei KMZ-Dateien enthalten nur Netzwerklinks).

Der Bericht wird automatisch erzeugt (`npm run import:report`). Dieselben Befunde sieht der Admin im Adminbereich unter **Kartenversionen → Importbericht**. Dort kann er jeden Befund bestätigen oder ablehnen.
**Quelldaten werden nicht verändert.** Ein bestätigter Vorschlag ändert nur den Anzeigewert, der Originalwert bleibt gespeichert und protokolliert.

## 2.1 Dateien und Prüfsummen

| Karte | Datei | Grösse | SHA-256 |
|---|---|---|---|
| Aktive Fischer | `data/source/2026/kml-live-abruf/aktive-fischer-2026.kml` | 742 KB | `70ddcbf308045a61cda6be0983d22551c23a6b0d31cdf16e829abb48363ae142` |
| Jugendfischer | `data/source/2026/kml-live-abruf/jugendfischer-2026.kml` | 214 KB | `a2d9be0f2434b27453b8836abb824dcadfe4989ff446c9239b496df5e3a6a72e` |
| Tageskarte | `data/source/2026/kml-live-abruf/tageskarte-2026.kml` | 20 KB | `07205fe6be9ae5b5c05e2505ed41159f6e5dd783fc6a576887a1aa79aeec9313` |

## 2.2 Objektzahlen im Vergleich mit dem Anforderungsdokument

| Karte | Objekte (Ist / Soll) | Gewässernamen (Ist / Soll) | Punkte | Linien | Flächen | Gewässercodes | Ausdehnung (WGS84) |
|---|---|---|---|---|---|---|---|
| Aktive Fischer | 355 / 355 ✅ | 152 / 152 ✅ | 1 | 328 | 26 | 151, 152, 153, 171, 172, 181, 190, 210, 220, 230, 251, 252, 260, 270, 280, 300 | 9.3726, 47.0975, 9.5433, 47.2787 |
| Jugendfischer | 110 / 110 ✅ | 67 / 67 ✅ | 1 | 92 | 17 | 151, 152, 153, 171, 181, 190, 210, 220, 230, 252, 260, 270, 280, 300 | 9.3726, 47.0975, 9.5433, 47.2713 |
| Tageskarte | 10 / 10 ✅ | 4 / – | 1 | 9 | 0 | 151, 152, 153 | 9.4264, 47.0975, 9.5433, 47.2690 |

Tageskarte: 10 Objekte. Davon sind 7 Gewässerabschnitte (Werdenberger Binnenkanal), 1 Orientierungspunkt und 2 Pachtgrenzen. Die Angabe «ausschliesslich Werdenberger Binnenkanal» ist damit für die Gewässer bestätigt.

## 2.3 Ebenen und Regelzuordnung

### Aktive Fischer

| # | Ebene (Original) | Bedeutung in der App | Regelstatus | Objekte (Ist / Soll) | Punkte | Linien | Flächen |
|---|---|---|---|---|---|---|---|
| 1 | Natur- & Kunstköder, Löffel, Wobbler & Spinner | Alle Köder erlaubt | aus Quelle | 8 / 8 ✅ | 1 | 7 | 0 |
| 2 | Natur- & Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten) | Natur- & Kunstköder – ohne Spinner, Löffel, Wobbler, künstl. Köderfische | aus Quelle | 293 / 293 ✅ | 0 | 293 | 0 |
| 3 | Kiessämmler (gelten als Fliessgewässer) | Kiessämmler – gilt als Fliessgewässer | aus Quelle | 17 / 17 ✅ | 0 | 0 | 17 |
| 4 | Nur Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten) | Nur Kunstköder – Vorstandsklärung erforderlich | **Vorstandsklärung erforderlich** | 3 / 3 ✅ | 0 | 3 | 0 |
| 5 | Voralpsee | Voralpsee – eigene Regeln | nur importierter Text | 1 / 1 ✅ | 0 | 0 | 1 |
| 6 | gesperrte Gewässer | Gesperrt – Fischen verboten | aus Quelle | 29 / 29 ✅ | 0 | 21 | 8 |
| 7 | Pachtgrenze | Pachtgrenze | nur Darstellung | 3 / 3 ✅ | 0 | 3 | 0 |
| 8 | Grenze Berg-/Talgewässer | Grenze Berg-/Talgewässer | nur Darstellung | 1 / 1 ✅ | 0 | 1 | 0 |
| 9 | Unbenannte Ebene | Leere, unbenannte Ebene | nur Darstellung | 0 / – | 0 | 0 | 0 |
| 10 | Unbenannte Ebene | Leere, unbenannte Ebene | nur Darstellung | 0 / – | 0 | 0 | 0 |

### Jugendfischer

| # | Ebene (Original) | Bedeutung in der App | Regelstatus | Objekte (Ist / Soll) | Punkte | Linien | Flächen |
|---|---|---|---|---|---|---|---|
| 1 | Natur- & Kunstköder, Löffel, Wobbler & Spinner | Alle Köder erlaubt | aus Quelle | 7 / 7 ✅ | 1 | 6 | 0 |
| 2 | Natur- & Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten) | Natur- & Kunstköder – ohne Spinner, Löffel, Wobbler, künstl. Köderfische | aus Quelle | 62 / 62 ✅ | 0 | 62 | 0 |
| 3 | Kiessämmler (gelten als Fliessgewässer) | Kiessämmler – gilt als Fliessgewässer | aus Quelle | 10 / 10 ✅ | 0 | 0 | 10 |
| 4 | Nur Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten) | Nur Kunstköder – Vorstandsklärung erforderlich | **Vorstandsklärung erforderlich** | 3 / 3 ✅ | 0 | 3 | 0 |
| 5 | Voralpsee | Voralpsee – eigene Regeln | nur importierter Text | 1 / 1 ✅ | 0 | 0 | 1 |
| 6 | gesperrte Gewässer | Gesperrt – Fischen verboten | aus Quelle | 24 / 24 ✅ | 0 | 18 | 6 |
| 7 | Pachtgrenze | Pachtgrenze | nur Darstellung | 2 / 2 ✅ | 0 | 2 | 0 |
| 8 | Grenze Berg-/Talgewässer | Grenze Berg-/Talgewässer | nur Darstellung | 1 / 1 ✅ | 0 | 1 | 0 |

### Tageskarte

| # | Ebene (Original) | Bedeutung in der App | Regelstatus | Objekte (Ist / Soll) | Punkte | Linien | Flächen |
|---|---|---|---|---|---|---|---|
| 1 | Natur- & Kunstköder, Löffel, Wobbler & Spinner | Alle Köder erlaubt | aus Quelle | 5 / 5 ✅ | 1 | 4 | 0 |
| 2 | Nur Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten) | Nur Kunstköder – Vorstandsklärung erforderlich | **Vorstandsklärung erforderlich** | 2 / 2 ✅ | 0 | 2 | 0 |
| 3 | gesperrte Gewässer | Gesperrt – Fischen verboten | aus Quelle | 1 / 1 ✅ | 0 | 1 | 0 |
| 4 | Pachtgrenze | Pachtgrenze | nur Darstellung | 2 / 2 ✅ | 0 | 2 | 0 |

## 2.4 Gewässercodes

Gewässercodes sind **nicht eindeutig pro Gewässer**. Sie werden als Attribut des Abschnitts geführt, nicht als Schlüssel (siehe O29).

| Code | Abschnitte | Gewässernamen | Beispiele |
|---|---|---|---|
| 151 | 14 | 1 | Werdenberger Binnenkanal |
| 152 | 3 | 1 | Werdenberger Binnenkanal |
| 153 | 3 | 1 | Werdenberger Binnenkanal |
| 171 | 9 | 2 | Obere Talsperre, Sevelerbach |
| 172 | 1 | 1 | Fuchser Weiher |
| 181 | 78 | 31 | Buchser Giessen, Burgerauergiessen, Dürrenbach, Erbserenbach, Geissbach, Glathbach, … |
| 190 | 25 | 8 | Alter Buchserbach, Farbbach, Gästelenbach, Limserbach, Loggner Weiher, Loggnerbach, … |
| 210 | 15 | 7 | Grosstudenbach, Ivelspusbach, Lärenbach, Läuibach, Schutzbach, Studener Bach Weiher, … |
| 220 | 2 | 1 | Voralpsee |
| 230 | 51 | 29 | Amaggusabach, Bongertbach, Chalthusbach, Chrüzbergtobel, Eggbach, Ganalinbach, … |
| 251 | 32 | 16 | Ackerbach, Afagristbächli, Bongertbächli, Bruggbach, Chaltenbach, Chretzibach, … |
| 252 | 27 | 5 | Dorfbach, Mööslibach, Rinne, Simmi Tal, Unterer Simmi Weiher |
| 260 | 30 | 9 | Chelenbach, Kiesfang Steinenbach, Kobelbach, Mühlbach, Rheintaler Binnenkanal, Schindlerenbach, … |
| 270 | 49 | 9 | Felsbach, Gasenzenbach, Kiesfang Gasenzenbach, Kiesfang Zielbach, Läuibach, Rinne, … |
| 280 | 67 | 20 | Breitläuibach, Entwässerungskanal, Farbbach, Fuchsbrunnen, Giessen, Gloggerbach, … |
| 300 | 2 | 1 | Weierbächli |

Gewässerabschnitte ohne Code: 55. Betroffen sind gesperrte Gewässer (dort ist kein Code erfasst) sowie 2 Abschnitt(e) in Köderebenen (siehe Befunde).

## 2.5 Duplikate und Mehrfachvorkommen

- Identische Geometrien innerhalb einer Karte: **0**
- Jugendfischer: 61 von 110 Geometrien sind identisch mit der Karte «Aktive Fischer». Die übrigen sind eigenständig gezeichnet oder leicht abweichend. Jede Karte wird separat geführt.
- Tageskarte: 4 von 10 Geometrien sind identisch mit der Karte «Aktive Fischer». Die übrigen sind eigenständig gezeichnet oder leicht abweichend. Jede Karte wird separat geführt.
- Gewässer in mehreren Ebenen (Aktive Fischer), Regeln gelten pro Abschnitt: **Buchser Giessen** (Alle Köder erlaubt · Natur- & Kunstköder – ohne Spinner, Löffel, Wobbler, künstl. Köderfische · Gesperrt – Fischen verboten); **Werdenberger Binnenkanal** (Alle Köder erlaubt · Nur Kunstköder – Vorstandsklärung erforderlich · Gesperrt – Fischen verboten); **Rheintaler Binnenkanal** (Alle Köder erlaubt · Natur- & Kunstköder – ohne Spinner, Löffel, Wobbler, künstl. Köderfische)
- Gewässer mit den meisten Abschnitten (Aktive Fischer): Tobelbach (24), Rofisbach (15), Walchenbach (14), Rinne (10), Werdenberger Binnenkanal (8)

## 2.6 Befunde zur Datenqualität

29 Befunde: 2 Fehler, 10 Warnungen, 17 Hinweise. Status «offen» heisst: noch nicht durch einen Admin bestätigt. Nur Befunde mit Vorschlag können bestätigt werden und ändern dann den Anzeigewert.

| Schwere | Befund | Karte(n) | Ebene | Originalwert | Vorschlag | Status | Hinweis |
|---|---|---|---|---|---|---|---|
| 🔴 Fehler | Widerspruch bei «Buchser Giessen»: Köderebene, Beschreibung «gesperrt!» | Aktive Fischer | Natur- & Kunstköder, Löffel, Wobbler & Spinner | gesperrt! | – | offen | Die Ebene erlaubt das Fischen, die Beschreibung meldet eine Sperrung. Die App warnt vorsorglich und kennzeichnet den Abschnitt als widersprüchlich. (O28) |
| 🔴 Fehler | Widerspruch bei «Buchser Giessen»: Köderebene, Beschreibung «gesperrt!» | Jugendfischer | Natur- & Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten) | gesperrt! | – | offen | Die Ebene erlaubt das Fischen, die Beschreibung meldet eine Sperrung. Die App warnt vorsorglich und kennzeichnet den Abschnitt als widersprüchlich. (O28) |
| 🟠 Warnung | Vereinslokal unterschiedlich benannt: «Fischerei Verein Werdenberg» / «FVW Fischerheim» | Aktive Fischer | Natur- & Kunstköder, Löffel, Wobbler & Spinner | Fischerei Verein Werdenberg | FVW Fischerheim | offen | Vorschlag = häufigere Bezeichnung (2× in jugend, tageskarte). Das AD nennt beide Bezeichnungen. |
| 🟠 Warnung | Kein Gewässercode bei «Buchser Giessen» | Aktive Fischer | Natur- & Kunstköder, Löffel, Wobbler & Spinner | gesperrt! | – | offen | Abschnitt in einer Köderebene ohne Gewässercode. |
| 🟠 Warnung | Kein Gewässercode bei «Buchser Giessen» | Jugendfischer | Natur- & Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten) | gesperrt! | – | offen | Abschnitt in einer Köderebene ohne Gewässercode. |
| 🟠 Warnung | Schreibvariante «Lognerbach» / «Loggnerbach» | Aktive Fischer, Jugendfischer | – | Lognerbach | Loggnerbach | offen | Im Anforderungsdokument genannt. Vorschlag = häufigere Schreibweise (8× gegenüber 1×). Codes: 181, 190. Richtige Schreibweise vom Vorstand bestätigen. |
| 🟠 Warnung | Schreibvariante «Rogghalmtobel» / «Rogghalbtobel» | Aktive Fischer | – | Rogghalmtobel (1×) / Rogghalbtobel (1×) | – | offen | Im Anforderungsdokument genannt. Beide Schreibweisen gleich häufig – kein Vorschlag; der Vorstand legt die richtige Schreibweise fest (Admin kann den Wert beim Bestätigen eintragen). Codes: 230. |
| 🟠 Warnung | Köderregel «Nur Kunstköder» unklar – Vorstandsklärung erforderlich | Aktive Fischer | Nur Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten) | Nur Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten) | – | offen | Der Titel verbietet Spinner, Löffel, Wobbler und künstliche Köderfische; welche Köder erlaubt sind, ist offen. (O8) |
| 🟠 Warnung | Köderregel «Nur Kunstköder» unklar – Vorstandsklärung erforderlich | Jugendfischer | Nur Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten) | Nur Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten) | – | offen | Der Titel verbietet Spinner, Löffel, Wobbler und künstliche Köderfische; welche Köder erlaubt sind, ist offen. (O8) |
| 🟠 Warnung | Köderregel «Nur Kunstköder» unklar – Vorstandsklärung erforderlich | Tageskarte | Nur Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten) | Nur Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten) | – | offen | Der Titel verbietet Spinner, Löffel, Wobbler und künstliche Köderfische; welche Köder erlaubt sind, ist offen. (O8) |
| 🟠 Warnung | Zeitliche Regel nur als Freitext bei «Simmi Tal»: «ist bis 30.04. gesperrt» | Jugendfischer | Natur- & Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten) | ist bis 30.04. gesperrt | – | offen | Wird nicht automatisch in eine Datumsregel umgedeutet (fehlt z. B. Beginn und Jahr). Admin kann eine strukturierte Sperrzeit (von/bis) erfassen. (O10) |
| 🟠 Warnung | Zeitliche Regel nur als Freitext bei «Simmi Tal»: «ist bis 30.04.gesperrt» | Aktive Fischer | Natur- & Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten) | ist bis 30.04.gesperrt | – | offen | Wird nicht automatisch in eine Datumsregel umgedeutet (fehlt z. B. Beginn und Jahr). Admin kann eine strukturierte Sperrzeit (von/bis) erfassen. (O10) |
| 🔵 Info | Uneinheitlicher Code «Code:151» | Aktive Fischer, Jugendfischer | Nur Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten) | Code:151 | Gewässercode: 151 | offen | Der Code wurde trotzdem erkannt; der Vorschlag betrifft nur die Schreibweise. |
| 🔵 Info | Auffälliger Leerraum in der Beschreibung von «Burgerauergiessen» | Aktive Fischer | gesperrte Gewässer | "Gewässercode: 181                                      gesperrt!" | Gewässercode: 181 gesperrt! | offen | Für die Anzeige wird Leerraum immer zusammengefasst; der Inhalt ändert sich nicht. |
| 🔵 Info | Leere Ebene «Unbenannte Ebene» | Aktive Fischer | Unbenannte Ebene | Unbenannte Ebene | (Ebene in My Maps löschen) | offen | Die Ebene enthält keine Objekte und wird in der App nicht angezeigt. |
| 🔵 Info | Leere Ebene «Unbenannte Ebene» | Aktive Fischer | Unbenannte Ebene | Unbenannte Ebene | (Ebene in My Maps löschen) | offen | Die Ebene enthält keine Objekte und wird in der App nicht angezeigt. |
| 🔵 Info | 11 Gewässernamen tragen mehrere Gewässercodes | Aktive Fischer, Jugendfischer, Tageskarte | – | Werdenberger Binnenkanal: 151/152/153; Tobelbach: 181/280; Kobelbach: 260/280; Walchenbach: 230/270; Stoggenbach: 181/230; Loggnerbach: 181/190; Läuibach: 210/270; Farbbach: 190/280; Rinne: 190/252/270; Mühlbach: 260/280; Mööslibach: 251/252 | – | offen | Kein Fehler im engeren Sinn: Regeln und Codes gelten pro Abschnitt. Bedeutung der Codes bestätigen. (O29) |
| 🔵 Info | Mögliche Schreibvariante «Kobelbach» / «Tobelbach» | Aktive Fischer, Jugendfischer | – | Kobelbach (2×) / Tobelbach (26×) | – | offen | Namen unterscheiden sich in nur einem Zeichen. Codes Kobelbach: 280, 260; Tobelbach: 181, 280 (gemeinsamer Code 280). Kann ein anderes Gewässer sein – kein automatischer Vorschlag. |
| 🔵 Info | Mögliche Schreibvariante «Rieterenbach» / «Ritterenbach» | Aktive Fischer | – | Rieterenbach (3×) / Ritterenbach (1×) | – | offen | Namen unterscheiden sich in nur einem Zeichen. Codes Rieterenbach: 230; Ritterenbach: 230 (gemeinsamer Code 230). Kann ein anderes Gewässer sein – kein automatischer Vorschlag. |
| 🔵 Info | Leerzeichen im Namen «Böschni Steinig Furt » | Aktive Fischer | – | Böschni Steinig Furt  | Böschni Steinig Furt | offen | Nur Leerraum betroffen. |
| 🔵 Info | Leerzeichen im Namen «Kiesfang Grabser Bach ( Hasenbünt)» | Aktive Fischer | – | Kiesfang Grabser Bach ( Hasenbünt) | Kiesfang Grabser Bach (Hasenbünt) | offen | Nur Leerraum betroffen. |
| 🔵 Info | 14 Objekte mit Foto (nur online verfügbar) | Aktive Fischer, Jugendfischer, Tageskarte | – | mymaps.usercontent.google.com | – | offen | Fotos sind in der Beschreibung verlinkt und werden nicht offline gespeichert. Die App zeigt sie nur mit Verbindung. |
| 🔵 Info | Punkt «Fischerei Verein Werdenberg» liegt in einer Köderebene | Aktive Fischer | Natur- & Kunstköder, Löffel, Wobbler & Spinner | Natur- & Kunstköder, Löffel, Wobbler & Spinner | – | offen | Der Punkt wird als Orientierungspunkt dargestellt, nicht als Gewässerabschnitt; die Köderregel der Ebene gilt nicht für ihn. |
| 🔵 Info | Punkt «FVW Fischerheim» liegt in einer Köderebene | Jugendfischer, Tageskarte | Natur- & Kunstköder, Löffel, Wobbler & Spinner | Natur- & Kunstköder, Löffel, Wobbler & Spinner | – | offen | Der Punkt wird als Orientierungspunkt dargestellt, nicht als Gewässerabschnitt; die Köderregel der Ebene gilt nicht für ihn. |
| 🔵 Info | Regeltext weicht vom Ebenentitel ab (1×) | Aktive Fischer | Voralpsee | Natur- & Kunstköder, Löffel, Wobbler & Spinner erlaubt. | – | offen | Ebene «Voralpsee». In der App werden Ebenenregel und Regeltext getrennt angezeigt; es wird nichts zusammengeführt. (O20) |
| 🔵 Info | Regeltext weicht vom Ebenentitel ab (1×) | Jugendfischer | Voralpsee | Natur- & Kunstköder, Löffel, Wobbler & Spinner erlaubt. | – | offen | Ebene «Voralpsee». In der App werden Ebenenregel und Regeltext getrennt angezeigt; es wird nichts zusammengeführt. (O20) |
| 🔵 Info | Regeltext weicht vom Ebenentitel ab (10×) | Jugendfischer | Kiessämmler (gelten als Fliessgewässer) | Natur- & Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten) | – | offen | Ebene «Kiessämmler (gelten als Fliessgewässer)». In der App werden Ebenenregel und Regeltext getrennt angezeigt; es wird nichts zusammengeführt. (O21) |
| 🔵 Info | Regeltext weicht vom Ebenentitel ab (17×) | Aktive Fischer | Kiessämmler (gelten als Fliessgewässer) | Natur- & Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten) | – | offen | Ebene «Kiessämmler (gelten als Fliessgewässer)». In der App werden Ebenenregel und Regeltext getrennt angezeigt; es wird nichts zusammengeführt. (O21) |
| 🔵 Info | Tippfehler im Regeltext bei «Afagristbächli»: «NNatur» | Aktive Fischer | Natur- & Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten) | NNatur- & Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten) | Natur- & Kunstköder (Spinner, Löffel, Wobbler & künstliche Köderfische verboten) | offen | Verdoppelter Grossbuchstabe am Wortanfang. |

## 2.7 Fehlende oder nicht offline verfügbare Daten

- **Geprüfte KML-Basisdateien fehlen.** Die hochgeladenen KMZ-Dateien enthalten nur Netzwerklinks. Die Daten stammen deshalb aus dem Live-Abruf vom 15.11.2026. Die Dateigrössen stimmen mit den Angaben im Anforderungsdokument überein (ca. 760, 220 und 20 KB). Ein Admin muss die Version als Basis bestätigen.
- **Sperrzeiten**: Es gibt keine strukturierten Daten. Der einzige Freitext ist Simmi Tal «bis 30.04. gesperrt» (siehe Befunde, O10).
- **Mindestmasse, Schonzeiten, Fanglimiten**: nicht in den Quelldaten enthalten und deshalb nicht umgesetzt (O19).
- **Gewässerzustand**: Er ist nicht Teil der Kartendaten und wird über News der Kategorie «Gewässerzustand» gepflegt.
- **Fotos** in den Beschreibungen liegen bei Google (mymaps.usercontent.google.com) und sind nur online sichtbar.
- **Vereinslogo** `logo-transparent.png`: nicht geliefert. Die App verwendet bis dahin einen neutralen Platzhalter.

## 2.8 Gewässerliste (abgeleitet, Anzeigenamen ohne bestätigte Normalisierungen)

| Gewässer | Karten | Codes | Abschnitte | gesperrte Abschnitte |
|---|---|---|---|---|
| Ackerbach | Aktive Fischer | 251 | 1 |  |
| Aebi Weiher | Aktive Fischer, Jugendfischer | – | 4 | 4 |
| Aegetenbächli | Aktive Fischer, Jugendfischer | – | 2 | 2 |
| Afagristbächli | Aktive Fischer | 251 | 3 |  |
| Afrikasee | Aktive Fischer, Jugendfischer | – | 2 | 2 |
| Alter Buchserbach | Aktive Fischer, Jugendfischer | 190 | 2 |  |
| Amaggusabach | Aktive Fischer | 230 | 1 |  |
| Bahngraben | Aktive Fischer, Jugendfischer | – | 6 | 6 |
| Bongertbach | Aktive Fischer | 230 | 1 |  |
| Bongertbächli | Aktive Fischer | 251 | 1 |  |
| Böschengiessen | Aktive Fischer, Jugendfischer | – | 2 | 2 |
| Böschni Steinig Furt | Aktive Fischer, Jugendfischer | – | 5 | 5 |
| Breitläuibach | Aktive Fischer | 280 | 1 |  |
| Bruggbach | Aktive Fischer | 251 | 2 |  |
| Buchser Giessen | Aktive Fischer, Jugendfischer | 181 | 9 | 5 |
| Burgerauergiessen | Aktive Fischer | 181 | 1 | 1 |
| Chaltenbach | Aktive Fischer | 251 | 1 |  |
| Chalthusbach | Aktive Fischer | 230 | 1 |  |
| Chelenbach | Aktive Fischer | 260 | 4 |  |
| Chretzibach | Aktive Fischer | 251 | 1 |  |
| Chrüzbergtobel | Aktive Fischer | 230 | 1 |  |
| Dorfbach | Aktive Fischer, Jugendfischer | 252 | 2 |  |
| Dreinamenbach | Aktive Fischer | 251 | 5 |  |
| Dürrenbach | Aktive Fischer | 181 | 1 |  |
| Egelsee | Aktive Fischer, Jugendfischer | – | 2 | 2 |
| Eggbach | Aktive Fischer | 230 | 1 |  |
| Eisenbahnbächli | Aktive Fischer, Jugendfischer | – | 6 | 6 |
| Entwässerungskanal | Aktive Fischer, Jugendfischer | 280 | 2 |  |
| Erbserenbach | Aktive Fischer | 181 | 4 |  |
| EW Weiher | Aktive Fischer | – | 1 | 1 |
| Fabrikkanal | Aktive Fischer, Jugendfischer | – | 2 | 2 |
| Farbbach | Aktive Fischer, Jugendfischer | 190, 280 | 8 |  |
| Felsbach | Aktive Fischer | 270 | 7 |  |
| Fösera Rinne | Aktive Fischer, Jugendfischer | – | 2 | 2 |
| Fuchsbrunnen | Aktive Fischer, Jugendfischer | 280 | 2 |  |
| Fuchser Weiher | Aktive Fischer | 172 | 1 |  |
| Ganalinbach | Aktive Fischer | 230 | 1 |  |
| Gasenzenbach | Aktive Fischer, Jugendfischer | 270 | 10 |  |
| Gästelenbach | Aktive Fischer | 190 | 2 |  |
| Geissbach | Aktive Fischer | 181 | 8 |  |
| Giessen | Aktive Fischer, Jugendfischer | 280 | 2 |  |
| Glathbach | Aktive Fischer | 181 | 1 |  |
| Glatweiher | Aktive Fischer | 181 | 1 |  |
| Gloggerbach | Aktive Fischer | 280 | 1 |  |
| Gnapfbach | Aktive Fischer | 181 | 1 |  |
| Gogenbach | Aktive Fischer | 230 | 1 |  |
| Graben | Aktive Fischer, Jugendfischer | 230 | 2 |  |
| Grabserbach | Aktive Fischer, Jugendfischer | 230 | 7 |  |
| Grosstudenbach | Aktive Fischer | 210 | 1 |  |
| Haagerkompromiss | Aktive Fischer, Jugendfischer | 280 | 2 |  |
| Haldenbächli | Aktive Fischer, Jugendfischer | 280 | 2 |  |
| Hardeggbächli | Aktive Fischer | 251 | 1 |  |
| Haselbach | Aktive Fischer | 181 | 2 |  |
| Heldbach | Aktive Fischer | 181 | 2 |  |
| Hermanntobel | Aktive Fischer | 230 | 1 |  |
| Hinterer Muntlerentschbach | Aktive Fischer | 230 | 2 |  |
| Huebbach | Aktive Fischer, Jugendfischer | 280 | 4 |  |
| Ilsbächli | Aktive Fischer | 230 | 1 |  |
| Islabellbach | Aktive Fischer, Jugendfischer | – | 2 | 2 |
| Ivelspusbach | Aktive Fischer | 210 | 6 |  |
| Kiesfang Gasenzenbach | Aktive Fischer, Jugendfischer | 270 | 2 |  |
| Kiesfang Grabser Bach (Hasenbünt) | Aktive Fischer, Jugendfischer | 230 | 2 |  |
| Kiesfang Mühlbach | Aktive Fischer, Jugendfischer | 280 | 2 |  |
| Kiesfang Rofisbach | Aktive Fischer, Jugendfischer | 280 | 2 |  |
| Kiesfang Röllbach | Aktive Fischer | 181 | 1 |  |
| Kiesfang Steinenbach | Aktive Fischer, Jugendfischer | 260 | 2 |  |
| Kiesfang Tobelbach | Aktive Fischer, Jugendfischer | 181 | 2 |  |
| Kiesfang Wislen | Aktive Fischer, Jugendfischer | 280 | 2 |  |
| Kiesfang Zielbach | Aktive Fischer, Jugendfischer | 270 | 2 |  |
| Kobelbach | Aktive Fischer | 260, 280 | 2 |  |
| Lärenbach | Aktive Fischer | 210 | 1 |  |
| Läuibach | Aktive Fischer | 210, 270 | 6 |  |
| Lehnbach | Aktive Fischer | 230 | 2 |  |
| Limserbach | Aktive Fischer, Jugendfischer | 190 | 4 |  |
| Littenbächli | Aktive Fischer | 181 | 1 |  |
| Lobergraben | Aktive Fischer, Jugendfischer | 230 | 2 |  |
| Löchlibach | Aktive Fischer | 181 | 3 |  |
| Loggner Weiher | Aktive Fischer, Jugendfischer | 190 | 2 |  |
| Loggnerbach | Aktive Fischer, Jugendfischer | 181, 190 | 8 |  |
| Lognerbach | Aktive Fischer | 181 | 1 |  |
| Martinstöbelibach | Aktive Fischer | 181 | 1 |  |
| Masorabach | Aktive Fischer | 181 | 1 |  |
| Moosbach | Aktive Fischer | 181 | 2 |  |
| Mööslibach | Aktive Fischer, Jugendfischer | 251, 252 | 4 |  |
| Mühlbach | Aktive Fischer, Jugendfischer | 260, 280 | 5 |  |
| Muserbächli | Aktive Fischer | 181 | 1 |  |
| Nellenbach | Aktive Fischer | 280 | 1 |  |
| Nesslabrünnelibach | Aktive Fischer | 181 | 1 |  |
| Nesslenbach | Aktive Fischer | 280 | 7 |  |
| Obere Talsperre | Aktive Fischer | 171 | 1 |  |
| Oberer Simmi Weiher | Aktive Fischer | 251 | 1 |  |
| Probstweiher | Aktive Fischer, Jugendfischer | – | 2 | 2 |
| Pülsbach / Grenzgraben | Aktive Fischer, Jugendfischer | 230 | 2 |  |
| Ransbach | Aktive Fischer | 181 | 1 |  |
| Rheintaler Binnenkanal | Aktive Fischer, Jugendfischer | 260 | 5 |  |
| Rieterenbach | Aktive Fischer | 230 | 3 |  |
| Rinne | Aktive Fischer, Jugendfischer | 190, 252, 270 | 18 |  |
| Ritterenbach | Aktive Fischer | 230 | 1 |  |
| Rofisbach | Aktive Fischer, Jugendfischer | 280 | 17 |  |
| Rogghalbtobel | Aktive Fischer | 230 | 1 |  |
| Rogghalmtobel | Aktive Fischer | 230 | 1 |  |
| Rogghalmweiher | Aktive Fischer | – | 1 | 1 |
| Röllbach | Aktive Fischer, Jugendfischer | 181 | 2 |  |
| Rössbach | Aktive Fischer | 181 | 1 |  |
| Rotenbach | Aktive Fischer | 230 | 4 |  |
| Ruchenschiltgraben | Aktive Fischer, Jugendfischer | 230 | 2 |  |
| Rütibach | Aktive Fischer | 251 | 6 |  |
| Saar | Aktive Fischer, Jugendfischer | 181 | 2 |  |
| Saarkanal | Aktive Fischer | 181 | 1 |  |
| Sägebach | Aktive Fischer | 181 | 1 |  |
| Salslittenbach | Aktive Fischer | 251 | 2 |  |
| Sarinabäche | Aktive Fischer | 181 | 2 |  |
| Schindlerenbach | Aktive Fischer | 260 | 6 |  |
| Schlipfbach | Aktive Fischer, Jugendfischer | 280 | 6 |  |
| Schlussbach | Aktive Fischer | 230 | 1 |  |
| Schmelzibach | Aktive Fischer | 260 | 2 |  |
| Schutzbach | Aktive Fischer | 210 | 1 |  |
| Sevelerbach | Aktive Fischer, Jugendfischer | 171 | 8 |  |
| Simmi Berg | Aktive Fischer | 251 | 3 |  |
| Simmi Tal | Aktive Fischer, Jugendfischer | 252 | 6 |  |
| Steinenbach | Aktive Fischer, Jugendfischer | 260 | 8 |  |
| Stoggenbach | Aktive Fischer | 181, 230 | 3 |  |
| Studener Bach Weiher | Aktive Fischer | 210 | 1 |  |
| Studnerbach | Aktive Fischer, Jugendfischer | 210 | 3 |  |
| Stutztobel | Aktive Fischer | 230 | 1 |  |
| Suweidbach | Aktive Fischer | 270 | 4 |  |
| Tobelbach | Aktive Fischer, Jugendfischer | 181, 280 | 26 |  |
| Tschilsbach | Aktive Fischer | 251 | 2 |  |
| Tuerichnerbächli/Steigbächli | Aktive Fischer | 181 | 1 |  |
| Unterer Simmi Weiher | Aktive Fischer, Jugendfischer | 252 | 2 |  |
| Vilierbächli | Aktive Fischer | 251 | 1 |  |
| Voralpsee | Aktive Fischer, Jugendfischer | 220 | 2 |  |
| Vorderer Muntlerentschbach | Aktive Fischer | 230 | 1 |  |
| Walchenbach | Aktive Fischer | 230, 270 | 14 |  |
| Wasserfassung Steinenbach | Aktive Fischer | 260 | 1 |  |
| Weibelaggerbächli | Aktive Fischer | 230 | 2 |  |
| Weidbach Rinne | Aktive Fischer, Jugendfischer | – | 2 | 2 |
| Weierbächli | Aktive Fischer, Jugendfischer | 300 | 2 |  |
| Werdenbächli | Aktive Fischer | 251 | 1 |  |
| Werdenberger Binnenkanal | Aktive Fischer, Jugendfischer, Tageskarte | 151, 152, 153 | 23 | 3 |
| Werdenbergersee | Aktive Fischer, Jugendfischer | – | 2 | 2 |
| Wetti | Aktive Fischer, Jugendfischer | 190 | 4 |  |
| Wislen | Aktive Fischer, Jugendfischer | 280 | 2 |  |
| Wislenhasel Rinne | Aktive Fischer, Jugendfischer | – | 2 | 2 |
| Wislenhaselbach | Aktive Fischer, Jugendfischer | – | 2 | 2 |
| Wurzitobel | Aktive Fischer | 230 | 1 |  |
| Zielbach | Aktive Fischer, Jugendfischer | 270 | 8 |  |
