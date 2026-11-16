# 10 Datenschutz (nDSG) und Sicherheit

| Grundsatz | Umsetzung |
|---|---|
| Datenminimierung | Aus Fairgate werden nur Name, Nummer, primäre E-Mail, Status und Gruppen übernommen. Von Gästen nur E-Mail, Name, Ticketnummer und Gültigkeit. Touren speichern **nur das Gewässer**, keine Koordinaten. |
| Standort | Standardmässig **aus**. Er wird erst nach einem Zweckhinweis in der App **und** der Freigabe des Betriebssystems genutzt. Es gibt keinen Verlauf und keine Übermittlung an den Verein. Bei Meldungen wird er nur mitgesendet, wenn die Person das ausdrücklich ankreuzt. Hintergrund-Standort ist im Android-Manifest ausdrücklich entfernt. |
| Zweckhinweise | Vor Standort, Kamera bzw. Fotos und QR-Scan zeigt die App einen eigenen Hinweis; zusätzlich gibt es die Systemtexte in `app.json`. Push wird nicht abgefragt, solange er nicht eingerichtet ist. |
| Übertragung | HTTPS im Betrieb (Reverse Proxy). Die App sendet den Token nur im Authorization-Header. |
| Speicherung auf dem Gerät | SQLite mit SQLCipher; der Schlüssel liegt im Keychain bzw. Keystore (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`). Das Sitzungstoken liegt im sicheren Speicher. |
| Anmeldung | Einmal-Code an die hinterlegte E-Mail; keine Passwörter. OTPs werden gehasht gespeichert und sind 10 Minuten gültig, mit begrenzten Versuchen. Die Antwort auf eine Code-Anfrage verrät nicht, ob eine E-Mail registriert ist. |
| Zugriffsrechte | Rollen- **und** Eigentumsprüfung im Backend bei jeder Anfrage (Tests: fremde Fänge, Kontrollen, Adminbereich). Kontrolldaten sehen nur der erfassende Aufseher und Admins; jeder Admin-Abruf wird protokolliert. |
| Geheimnisse | FSA, Eventfrog, SMTP, Push, Auth-Secret und Signaturschlüssel liegen nur in der Server-Umgebung. |
| Protokollierung | `audit_log` erfasst Anmeldungen (ohne Code), Importe, Karten- und Regeländerungen, Einstellungen, Rollen, Patente, Löschungen und Kontrollabrufe. `record_revision` erfasst jede Datenversion. |
| Auskunft & Löschung | App: «Meine Daten exportieren» (JSON) und «Löschung beantragen». Admin: Löschanträge prüfen und dann anonymisieren oder begründet ablehnen. |
| Gäste | Personendaten werden nach einer **vom Vorstand festzulegenden** Frist gelöscht; Fangdaten bleiben anonymisiert («Gast (anonymisiert)»). Ohne Frist wird nichts automatisch gelöscht. |
| Aufbewahrung | Fristen für Kontrollen, Vergehen und Meldungen sind konfigurierbar (O25). Ein Probelauf ist möglich. |
| Ausweis | Der QR enthält nur, was auf einem Papierpatent steht (Name, Patentart, Gültigkeit, Ausweis-Nr.), signiert mit Ed25519. |
| Auftragsverarbeitung | Hosting, E-Mail- und Push-Dienst sind noch zu wählen (O27), mit Vertrag nach nDSG und bevorzugt in der Schweiz oder EU. |

Restrisiken: Die Web-Vorschau ist nicht für echte Daten gedacht (keine Verschlüsselung). In Produktion darf `DEMO_MODE` nicht aktiv sein (technisch erzwungen). Die Ratenbegrenzung des Logins läuft im Speicher; bei mehreren Instanzen sollte sie zentral erfolgen, etwa per Reverse Proxy.
