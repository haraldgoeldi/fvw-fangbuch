# 7 Integrationen und Betriebsmodi

Grundsatz (PA §18): Eine Integration gilt nur als funktionsfähig, wenn Zugangsdaten, Freigaben und Endpunkte tatsächlich vorliegen. Jede Integration hat einen eigenen Adapter (`backend/src/integrations/`) mit Demo- bzw. Testmodus. Ihr Status (**nicht eingerichtet / Testmodus / aktiv / Fehler**) ist im Adminbereich, in der App (Mehr → Status) und in dieser Tabelle sichtbar. Fehlende Zugangsdaten legen den Rest des Prototyps nicht lahm.

| Integration | Status im Prototyp | Was funktioniert | Was fehlt für «aktiv» | Konfiguration |
|---|---|---|---|---|
| **Fairgate (FSA)** | **Testmodus** (Demo) | Abgleich fiktiver Kontakte, Login nur für berechtigte Status, Entzug bei Austritt (getestet) | FSA-Buchung, Access-Token, Public Key, **Endpunkt-Pfad und Feldnamen**. Die OpenAPI-Doku ist passwortgeschützt; der Adapter ist deshalb **nicht verifiziert**. | `FAIRGATE_MODE=live`, `FAIRGATE_BASE_URL` (fsa.fairgate.ch / fsa-test.fairgate.ch), `FAIRGATE_TOKEN`, `FAIRGATE_PUBLIC_KEY`, `FAIRGATE_CONTACTS_PATH`, `FAIRGATE_FIELD_MAP` |
| **Eventfrog Organizer API (Read)** | **Testmodus** (Demo) | Fiktive Bestellungen → Gastkonto → Tageskarte; Anmeldung per E-Mail oder Ticketnummer | Freischaltung und API-Schlüssel (Typ «Organizer read»), **Ressource für Bestellungen und Feldnamen** (API-Referenz docs.api.eventfrog.net war nicht zugänglich → **nicht verifiziert**). Limits 30/min, 2000/Tag sind berücksichtigt. | `EVENTFROG_MODE=live`, `EVENTFROG_API_KEY`, `EVENTFROG_ORDERS_PATH`, `EVENTFROG_FIELD_MAP` |
| **E-Mail** | **Testmodus** (Entwurf) | Anmeldecodes, Meldungen und Terminanmeldungen werden im Postausgang gespeichert (Admin → Postausgang), **nicht versendet** | SMTP-Zugang eines Versanddienstes (Auftragsverarbeitung) und Absenderadresse des Vereins | `MAIL_MODE=smtp`, `SMTP_URL`, `MAIL_FROM` |
| **Push** | **Testmodus** (Entwurf) | Push für wichtige News wird nur protokolliert. Die App fragt **keine** Push-Berechtigung ab, solange Push nicht eingerichtet ist. | Expo-Push-Zugang bzw. FCM/APNs, Entscheid zu Erinnerungen | `PUSH_MODE=expo`, `EXPO_ACCESS_TOKEN` |
| **Vereinswebseite (Termine)** | **Testmodus** (Demo-Termine) | Parser für iCal und RSS sowie schema.org-Events auf HTML-Seiten (störanfällig), Kalenderexport (.ics), Anmeldung | URL eines Termin-Feeds (O13) | `WEBSITE_MODE=ical\|rss\|html`, `WEBSITE_FEED_URL` |
| **Google My Maps** | **aktiv** | Täglicher Abruf der drei Netzwerklinks (am 15.11.2026 erfolgreich), Prüfsummenvergleich, neue Version als Entwurf, Fehlerfall mit gültiger Vorversion (getestet) | – (Voraussetzung: Freigabe «Jeder mit dem Link» bleibt bestehen) | `MYMAPS_MODE=live` (`file` für Tests) |
| **SMS (Plan B)** | **nicht eingerichtet** | – | SMS-Dienst und Handynummern aus Fairgate (O17). Ersatzweise gibt es den vom Vorstand erstellten Zugangscode. | – |

## Kartenhintergrund (Lizenz und Kosten)

- **Quelle:** swisstopo Landeskarte 1:25'000 (Ausgabe 2022, Blätter 1115, 1116, 1135, 1136, 1155, 1156) als Cloud-optimierte GeoTIFFs vom **Downloadservice** `data.geo.admin.ch` (STAC). Die Prüfsummen stehen im Manifest `data/basemap/*.json`.
- **Warum nicht der Kacheldienst (WMTS)?** Die «Allgemeinen Nutzungsbedingungen und Betriebsbestimmungen der BGDI» (geo.admin.ch, publiziert 9.12.2021) verlangen: *«Für den Bezug der Datensätze ausserhalb des Kontextes der Webdienste (Nutzung in offline Systemen, Datenbanken usw.) ist der Downloadservice zu nutzen.»* Bezug und Nutzung sind kostenlos; die Quellenangabe «© Data: swisstopo» ist Pflicht und wird auf der Karte angezeigt.
- **Annahme (vom Verein zu bestätigen, O22):** Die Datensatz-Bedingungen (swisstopo OGD, verlinkt im STAC-Katalog: https://www.swisstopo.admin.ch/ogd-conditions) erlauben die Weitergabe der aufbereiteten Kacheln in der Vereins-App. Die OGD-Seite selbst war aus der Entwicklungsumgebung nicht abrufbar.
- **Betriebskosten:** keine Lizenzkosten. Speicher: Basispaket 5,1 MB (in der App), Detailpaket 35 MB (Download vom Vereinsserver, nicht von swisstopo).
- **Fallback:** Ohne Kacheln zeigt die App die Gewässergeometrien auf neutralem Hintergrund.

## Sicherheit der Integrationen

- Zugangsdaten nur in der Server-Umgebung; die App enthält ausschliesslich die öffentliche Backend-URL.
- Fairgate-Antworten werden als JWT mit dem öffentlichen Schlüssel geprüft (RS256/ES256), sobald `FAIRGATE_PUBLIC_KEY` gesetzt ist.
- Wiederholungsversuche: E-Mail bis 5 Versuche (Job alle 5 min), Integrationsabrufe bei jedem Joblauf. Fehler gehen in `integration_log` und den Integrationsstatus «Fehler».
- Im Demo-Modus werden keine echten E-Mails, SMS, Push-Nachrichten oder Bestellungen versendet bzw. verändert. In Produktion ist der Demo-Modus technisch gesperrt.
