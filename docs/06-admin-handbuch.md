# 6 Admin-Handbuch (ohne Programmierkenntnisse)

Die Adminoberfläche ist im Browser unter `https://<domain>/admin/` erreichbar. Die Anmeldung erfolgt mit einem Einmal-Code an die E-Mail-Adresse aus Fairgate; Passwörter gibt es nicht. Alle Änderungen werden **versioniert und protokolliert** (Menü «Protokoll»). Rechte prüft immer das Backend.

## Erste Schritte nach der Inbetriebnahme

1. **Offene Entscheide** durchgehen (Menü «Offene Entscheide»). Jeder Eintrag zeigt das aktuelle Verhalten. Hat der Vorstand entschieden, «Erfassen» klicken und danach die passende Einstellung oder Regel anpassen.
2. **Kartenversionen**: Die aktiven Versionen stammen aus dem Live-Abruf vom 15.11.2026. Die geprüften KML-Exporte hochladen, Bericht und Vorschau ansehen und «Als geprüfte Basis aktivieren».
3. **Importbefunde**: Vorschläge zur Bereinigung bestätigen oder ablehnen, zum Beispiel «Lognerbach» → «Loggnerbach» oder «Code:151» → «Gewässercode: 151». Wo kein Vorschlag besteht (Rogghalbtobel/Rogghalmtobel), beim Bestätigen den richtigen Namen eintragen. Am besten zusätzlich in Google My Maps korrigieren.
4. **Einstellungen**: Empfänger, Gastfristen, Löschfristen und Bestätigungsart der Kontrolle festlegen, sobald entschieden. Einträge mit «nicht festgelegt» hat der Prototyp absichtlich leer gelassen.
5. **Personen & Rollen**: Aufseher- und Admin-Rollen vergeben (oder die Rollenquelle auf «Fairgate» stellen und die Gruppennamen eintragen).

## Häufige Aufgaben

| Aufgabe | Wo | Hinweise |
|---|---|---|
| Kurzfristige Sperrung melden | News → Kategorie «Sperrung» oder «Gewässerzustand», Gewässer wählen, Ablaufdatum setzen | Erscheint in der App bei News und auf der Karte beim Gewässer. Nach Ablauf wird die Meldung als «abgelaufen» gekennzeichnet. Push nur, wenn eingerichtet und aktiviert. |
| Zeitliche Sperre strukturiert erfassen | Sperrzeiten | Von/Bis und Grund. Die App warnt im Zeitraum. Freitexte aus My Maps werden **nicht** automatisch übernommen. |
| Köderregel nach Vorstandsentscheid anpassen | Köderregeln → Bearbeiten | Zum Beispiel «Nur Kunstköder» nach Klärung: Text und Status «aus Quelle/beschlossen». Versioniert und auf Startwert zurücksetzbar. |
| Neues Gewässer bestätigen | Gewässer → «Bestätigen» | Von Fischern erfasste Gewässer sind bis dahin nur für sie sichtbar. |
| Fischart ergänzen oder deaktivieren | Fischarten | Bestehende Fänge bleiben erhalten. |
| Patent ausstellen, verlängern, sperren | Patentarten & Patente | Gesperrte Ausweise kommen bei der nächsten Synchronisation auf die Sperrliste der Aufseher. Preise gibt es keine (O1/O2). |
| Tageskarten aus Eventfrog | 1. Einstellungen → Tageskarten: Eventfrog-Event-ID(s) eintragen, optional das Personalisierungsfeld mit dem Fischtag. 2. Patentarten: «Eventfrog-Ticketart» = Name der Ticketkategorie exakt wie in Eventfrog **oder** deren Kategorie-ID. | Abgleich alle 30 Minuten oder «Eventfrog-Abgleich jetzt». Tickets ohne zugeordnete Patentart erscheinen als Warnung unter Integrationen. In Eventfrog stornierte Tickets sperren die Tageskarte. |
| Mitglied ohne E-Mail | Personen & Rollen → «Zugangscode (ohne E-Mail)» | Der Einmalcode gilt 14 Tage und wird persönlich übergeben. |
| Fänge aller Mitglieder, CSV | Fänge (alle) | Filter nach Datum und Art; CSV für Excel. |
| Rücklaufquote | Rücklaufquote | Quote pro Patentart und Saison mit Liste fehlender Meldungen. **Keine Folgen** (O15). |
| Kontrollen einsehen | Kontrollen | Jeder Abruf wird protokolliert. Kein Versand an Behörden. |
| Meldungen (Verschmutzung) | Meldungen | Versandstatus; im Entwurfsmodus stehen die E-Mails nur im Postausgang. |
| Kartenänderung in My Maps prüfen | Kartenversionen → «Jetzt alle Netzwerklinks prüfen» | Bei gleicher Prüfsumme passiert nichts. Bei Änderung entsteht ein Entwurf: Bericht ansehen, dann aktivieren oder ablehnen. |
| Zur letzten gültigen Karte zurück | Kartenversionen → «Rückkehr zur letzten gültigen Version» | Protokolliert. |
| Sync-Konflikt lösen | Sync-Konflikte | Geräte- oder Serverstand übernehmen. Beide Stände bleiben in der Revision. |
| Löschantrag bearbeiten | Datenschutz & Löschung | Aufbewahrungspflichten prüfen, dann anonymisieren oder begründet ablehnen. |
| Integrationsfehler | Integrationen | Status, Fehlerprotokoll, «Jetzt ausführen». |

## Was der Admin **nicht** in der App pflegt

- Mitgliederdaten (Name, E-Mail, Status): führende Quelle ist **Fairgate**.
- Termine: führende Quelle ist die **Vereinswebseite** (Feed).
- Kartengeometrien: führende Quelle ist **Google My Maps** bzw. der geprüfte KML-Export.
