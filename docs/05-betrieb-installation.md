# 5 Installation und Betrieb

## 5.1 Voraussetzungen

- Node.js ≥ 22, npm ≥ 10
- PostgreSQL 16 (lokal oder gehostet)
- Für App-Builds: Expo-Konto (EAS Build) **oder** Android Studio bzw. Xcode für lokale Builds

## 5.2 Lokal starten (Demo-Modus)

**Am einfachsten mit Docker:** `docker compose up --build` im Hauptordner startet Datenbank, Backend mit Admin-Oberfläche (http://localhost:8787/admin/) und Web-Vorschau der App (http://localhost:8790). Details im [README](../README.md). Die folgenden Schritte beschreiben den Start ohne Docker.

```bash
npm install
```

```bash
./tools/dev/pg-start.sh
```

Das Skript startet PostgreSQL auf Port 5433 und legt die Datenbanken `fvw_dev` und `fvw_test` an. Eine eigene Postgres-Instanz geht ebenso; dann `DATABASE_URL` anpassen.

```bash
cp backend/.env.example backend/.env
```

In `backend/.env` zwei Werte setzen:

- `BETTER_AUTH_SECRET`: Zufallswert, z. B. aus `openssl rand -base64 48`
- `CREDENTIAL_SIGNING_KEY`: Ausgabe von `npm run keygen -w @fvw/backend`

```bash
npm run seed:demo -w @fvw/backend
```

Das führt die Migration aus, importiert die Karten und legt die Demo-Personen, Demo-Patente und Demo-Termine an.

```bash
npm run dev -w @fvw/backend
```

Damit laufen API und Admin-Oberfläche auf http://localhost:8787 (Admin: http://localhost:8787/admin/).

App auf dem Handy (Expo Go, ohne SQLCipher-Verschlüsselung):

```bash
cd app && EXPO_PUBLIC_API_URL=http://<IP-des-Rechners>:8787 npx expo start
```

App als Development-Build mit Verschlüsselung (Android Studio bzw. Xcode nötig):

```bash
cd app && EXPO_PUBLIC_API_URL=http://<IP>:8787 npx expo run:android
```

App im Browser (nur Vorschau und Tests; Daten im Browser-Speicher, nicht verschlüsselt):

```bash
cd app && EXPO_PUBLIC_API_URL=http://localhost:8787 npx expo export -p web --output-dir dist-web
```

```bash
node tools/dev/serve-web.mjs 8790
```

Danach ist die Vorschau unter http://localhost:8790 erreichbar.

**Demo-Konten** (fiktiv, Domain `.invalid`; der Code erscheint im Demo-Modus direkt in der App):

| E-Mail | Rolle / Zweck |
|---|---|
| mitglied@demo.fvw.invalid | Mitglied mit zwei Demo-Patenten (Karte umschaltbar) |
| jugend@demo.fvw.invalid | Jugendfischer |
| aufseher@demo.fvw.invalid | Aufseher (Kontrolle) |
| vorstand@demo.fvw.invalid | Vorstand/Admin |
| gast@demo.fvw.invalid | Tageskarte gültig heute (Eventfrog-Demo), Ticket DEMO-TK-0001 |
| gast-abgelaufen@demo.fvw.invalid | abgelaufene Tageskarte → kein Zugang |
| ausgetreten@demo.fvw.invalid | Fairgate-Status «ausgetreten» → kein Zugang |
| Demo OhneEmail | Mitglied ohne E-Mail → Zugangscode über Admin → Personen |

## 5.3 Tests

```bash
npm test
```

Das sind 24 Shared-Tests und 28 Backend-Integrationstests gegen die Test-Datenbank `fvw_test`.

```bash
node --test e2e/app.e2e.mjs
```

Das sind 11 End-to-End-Abläufe. Voraussetzung: Backend im Demo-Modus auf :8787 und Web-Vorschau auf :8790, z. B. per `docker compose up --build`.

```bash
node e2e/admin-web.smoke.cjs
```

Das ist der Rauchtest der Admin-Oberfläche.

```bash
npm run typecheck
```

```bash
cd app && npx tsc --noEmit
```

## 5.4 Test- und Produktivkonfiguration

Die Konfiguration erfolgt ausschliesslich über Umgebungsvariablen (siehe `backend/.env.example`):

| | Test / Demo | Produktion |
|---|---|---|
| `NODE_ENV` | `development` / `test` | `production` (Start bricht ab, falls `DEMO_MODE=true`) |
| `DATABASE_URL` | `fvw_dev` / `fvw_test` | eigene Produktivdatenbank |
| `DEMO_MODE` | `true` | `false` |
| `FAIRGATE_MODE`, `EVENTFROG_MODE`, `WEBSITE_MODE` | `demo` | `live` bzw. `ical`/`rss`, sobald Zugang besteht |
| `MAIL_MODE` | `draft` (nur Postausgang) | `smtp` mit `SMTP_URL`, sobald ein Versanddienst vertraglich geregelt ist |
| `PUSH_MODE` | `draft` | `expo` mit `EXPO_ACCESS_TOKEN` |
| `ADMIN_BOOTSTRAP_EMAILS` | – | E-Mail(s) des Vorstands für die erste Admin-Rolle |
| `CORS_ORIGINS` | `*` | Domain der Admin-Oberfläche |

Geheimnisse (FSA-Token, Eventfrog-Schlüssel, SMTP, Expo-Token, Auth-Secret, Signaturschlüssel) gehören nur in die Server-Umgebung, **nie** in die App oder ins Repository.

## 5.5 Produktivbetrieb (Vorschlag, offen O27)

- Hosting in der Schweiz (z. B. ein CH-Anbieter mit Auftragsverarbeitungsvertrag), HTTPS zwingend, Reverse Proxy (z. B. Caddy oder nginx).
- Start: `npm run start -w @fvw/backend` (führt Migrationen automatisch aus). Hintergrundjobs laufen im Prozess (`JOBS_ENABLED=true` nur auf **einer** Instanz).
- Backups: tägliches `pg_dump` der Datenbank und Sicherung von `STORAGE_DIR` (Fotos). Die Aufbewahrung richtet sich nach den Vereinsfristen (O25).
- Monitoring: `GET /api/health`. Integrationsfehler stehen unter Admin → Integrationen und gehen per E-Mail an `recipients.admin_alerts`, sobald gesetzt.
- App-Builds: `eas build -p android|ios` mit `EXPO_PUBLIC_API_URL=https://<domain>`. Verteilung über Play Store und App Store (Vereinskonto nötig), alternativ intern (TestFlight bzw. Play Internal Testing).

## 5.6 Hintergrundjobs

| Job | Intervall | Zweck |
|---|---|---|
| `map-check` | täglich | Netzwerklinks der My-Maps-Karten abrufen, Prüfsumme vergleichen, bei Änderung neue Version als Entwurf und Hinweis an den Admin |
| `fairgate-sync` | 6 h | Mitgliederabgleich, Zugriff bei Austritt oder Sperre entziehen |
| `eventfrog-sync` | 30 min | Tageskarten-Bestellungen (≤ 48 Abrufe/Tag; Eventfrog-Limit 2000/Tag) |
| `website-events` | 6 h | Termine von der Vereinswebseite |
| `mail-retry` | 5 min | Wiederholung ausstehender E-Mails (nur bei aktivem SMTP) |
| `retention` | täglich | Löschfristen, **nur** wenn der Vorstand sie festgelegt hat |

Manuell auslösen:

```bash
npm run jobs:run -w @fvw/backend -- map-check
```

Alternativ unter Admin → Integrationen → «Jetzt ausführen».

## 5.7 Kartenpflege und Jahreswechsel (ohne App-Neubau)

1. In Google My Maps die neue Saisonkarte anlegen und für «Jeder mit dem Link» freigeben.
2. Admin → Kartenversionen → «Neue Saison / Quelle erfassen»: Jahr, Kartengruppe, Titel und My-Maps-ID eintragen.
3. Geprüfte KML-Exporte hochladen (Admin → Kartenversionen → Datei importieren). Danach Bericht und Vorschau prüfen und «Als geprüfte Basis aktivieren».
4. Admin → Einstellungen → Saison: `season.current_year` umstellen, Saisonbeginn und -ende erfassen.
5. Patentarten der neuen Saison erfassen und Patente ausstellen bzw. aus Eventfrog übernehmen.
6. Die Apps laden beim nächsten Online-Kontakt die neue Version («Gewässerkarte aktualisiert am …»).

Basiskarte neu erzeugen (z. B. neue LK25-Ausgabe):

```bash
python tools/basemap/build_basemap.py --geojson <gewässer.geojson> --out data/basemap/lk25-werdenberg-detail.mbtiles
```

Für das Basispaket zusätzlich `--maxzoom 14 --full-upto 14` setzen. Danach `app/assets/basemap/` aktualisieren und eine neue App-Version bauen. Die Detaildatei lädt die App ohne Neubau vom Backend.

## 5.8 Kartenimport von der Kommandozeile

```bash
npm run import:report
```

Das erzeugt `docs/02-importbericht.md` und `data/derived/2026/*` neu.

```bash
npm run import:maps -w @fvw/backend -- --dir <ordner-mit-kml>
```

Das importiert und aktiviert die Karten, als Live-Abruf und noch ungeprüft.

```bash
npm run import:maps -w @fvw/backend -- --dir <ordner-mit-kml> --verified
```

Das aktiviert die Karten als geprüfte Basis. Nur für bestätigte Exporte verwenden.
