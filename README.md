# Fangbuch- und Patent-App – Fischereiverein Werdenberg (Prototyp, Saison 2026)

Offlinefähige Mobile App (iOS/Android) mit Backend und Admin-Weboberfläche. Sie umfasst Fangbuch mit Touren, Fängen und Nullmeldungen, Gewässerkarte mit Regeln pro Abschnitt, Patent- und Tageskarten-Ausweis, Aufseher-Kontrolle, News und Gewässerzustand, Termine, Meldungen sowie Rücklaufquote.

> **Status:** funktionsfähiger Prototyp im **Demo-Modus**. Die Patentverwaltung ist ein **Vorschlag** (nicht beschlossen). Offene Vorstandsentscheide werden nicht durch erfundene Werte ersetzt.

## Dokumentation

| | |
|---|---|
| [01 Anforderungen](docs/01-anforderungen.md) | Tabelle: Anforderung, Status (beschlossen/Vorschlag/offen), Quelle, Funktion, Abhängigkeit |
| [02 Importbericht](docs/02-importbericht.md) | Gewässerkarten 2026: Objektzahlen, Ebenen, Codes, Duplikate, Schreibvarianten, Befunde |
| [03 Offene Entscheidungen](docs/03-offene-entscheidungen.md) | O1–O31, mit dem Verhalten bis zur Entscheidung |
| [04 Architektur](docs/04-architektur.md) | Technologie, Datenmodell, Sync, Rollenmatrix, Navigation |
| [05 Installation & Betrieb](docs/05-betrieb-installation.md) | Lokal starten, Tests, Test-/Produktivkonfiguration, Jobs, Jahreswechsel |
| [06 Admin-Handbuch](docs/06-admin-handbuch.md) | Pflege ohne Programmierkenntnisse |
| [07 Integrationen](docs/07-integrationen.md) | Fairgate, Eventfrog, E-Mail, Push, Webseite, My Maps, Kartenlizenz |
| [08 Annahmen](docs/08-annahmen.md) | Annahmen, fehlende Quelldaten, technische Grenzen |
| [09 Akzeptanz](docs/09-akzeptanz.md) | Prüfung der 17 Akzeptanzkriterien mit Nachweisen |
| [10 Datenschutz & Sicherheit](docs/10-datenschutz-sicherheit.md) | nDSG-Umsetzung |

## Schnellstart mit Docker (empfohlen)

Voraussetzung ist nur [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows, macOS) bzw. Docker mit Compose-Plugin (Linux).

```bash
docker compose up --build
```

Der erste Start dauert einige Minuten. Danach laufen:

| Dienst | Adresse |
|---|---|
| Admin-Oberfläche | http://localhost:8787/admin/ (Demo-Konto: vorstand@demo.fvw.invalid, der Code erscheint im Demo-Modus direkt) |
| App im Browser (Web-Vorschau) | http://localhost:8790 |
| API | http://localhost:8787/api/health |

Das startet PostgreSQL 16, das Backend im **Demo-Modus** mit Demo-Daten und die Web-Vorschau der App. Die Schlüssel (`BETTER_AUTH_SECRET`, `CREDENTIAL_SIGNING_KEY`) werden beim ersten Start erzeugt und zusammen mit der Datenbank in Docker-Volumes gespeichert, Daten und Anmeldungen überstehen also einen Neustart.

Stoppen mit `Ctrl+C` bzw. `docker compose down`. Alles zurücksetzen (Datenbank und Schlüssel löschen): `docker compose down -v`.

Die End-to-End-Tests laufen gegen diesen Stack (Node.js ≥ 22 und Playwright auf dem Rechner nötig):

```bash
node --test e2e/app.e2e.mjs
```

> Die Docker-Konfiguration ist nur für Demo und Tests gedacht. Für den Produktivbetrieb siehe [docs/05](docs/05-betrieb-installation.md), Abschnitt 5.5.

## Schnellstart ohne Docker (Entwicklung)

```bash
npm install
```

```bash
./tools/dev/pg-start.sh
```

```bash
cp backend/.env.example backend/.env
```

In `backend/.env` die Werte `BETTER_AUTH_SECRET` und `CREDENTIAL_SIGNING_KEY` setzen (siehe [docs/05](docs/05-betrieb-installation.md)).

```bash
npm run seed:demo -w @fvw/backend
```

```bash
npm run dev -w @fvw/backend
```

Die Admin-Oberfläche ist dann unter http://localhost:8787/admin/ erreichbar (Demo-Konto: vorstand@demo.fvw.invalid).

```bash
cd app && EXPO_PUBLIC_API_URL=http://<IP>:8787 npx expo start
```

Danach die App mit Expo Go öffnen, oder `npx expo run:android|ios` für einen Build mit Verschlüsselung.

## Tests

```bash
npm test
```

Das sind 24 Fachlogik- und 28 Backend-Integrationstests.

```bash
node --test e2e/app.e2e.mjs
```

Das sind 11 End-to-End-Abläufe; die Voraussetzungen stehen in docs/05.

## Struktur

`app/` Expo-App · `backend/` API, Admin-Web, Migrationen, Adapter · `packages/shared/` gemeinsame Fachlogik · `data/` Quelldaten, abgeleitete Karten, Offline-Basiskarte · `tools/` Import- und Kartenwerkzeuge · `e2e/` End-to-End-Tests · `docs/` Dokumentation und Screenshots · `Dockerfile`, `docker-compose.yml`, `docker/` Start per Docker.

Kartenhintergrund: © Data: swisstopo (Landeskarte 1:25'000, Downloadservice).
