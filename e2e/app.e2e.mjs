/**
 * End-to-End-Tests der App (Web-Vorschau des Expo-Builds) gegen das Backend im Demo-Modus.
 * Voraussetzungen: Backend auf :8787 (DEMO_MODE, Demo-Daten), Web-Export auf :8790 (tools/dev/serve-web.mjs).
 *   node --test e2e/app.e2e.mjs
 * Screenshots: docs/screenshots/
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const APP = process.env.APP_URL ?? 'http://localhost:8790';
const API = process.env.API_URL ?? 'http://localhost:8787/api';
const SHOTS = resolve(import.meta.dirname, '../docs/screenshots');
const POINTS = JSON.parse(readFileSync(resolve(import.meta.dirname, 'test-points.json'), 'utf8'));
mkdirSync(SHOTS, { recursive: true });

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

// ---------------------------------------------------------------- Hilfen
async function apiLogin(email) {
  await fetch(`${API}/auth/request-code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  const mails = await (await fetch(`${API}/demo/mailbox?email=${encodeURIComponent(email)}`)).json();
  const code = /lautet: (\d{6})/.exec(mails[0].body)[1];
  const r = await (await fetch(`${API}/auth/verify-code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, code }) })).json();
  return r.token;
}
const apiGet = async (token, path) => (await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })).json();

async function newPhone(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'de-CH', timezoneId: 'Europe/Zurich', acceptDownloads: true, ...opts });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  return { ctx, page };
}
const tid = (id) => `[data-testid="${id}"]`;
async function shot(page, name) { await page.screenshot({ path: `${SHOTS}/${name}.png` }); }
/** Wartet auf ein Element; bei Zeitüberschreitung Diagnose (sichtbarer Text) ausgeben. */
async function see(page, locator, timeout = 30_000) {
  try { await locator.waitFor({ timeout }); } catch (e) {
    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 1200)).catch(() => '');
    console.log(`DIAGNOSE ${page.url()}: ${text}`);
    throw e;
  }
}

async function appLogin(page, email) {
  await page.goto(APP);
  await page.waitForSelector(tid('login-email'), { timeout: 30_000 });
  await page.fill(tid('login-email'), email);
  await page.click(tid('login-request'));
  const banner = page.getByText(/Ihr Demo-Code: \d{6}/);
  await banner.waitFor({ timeout: 20_000 });
  const code = (await banner.textContent()).match(/(\d{6})/)[1];
  await page.fill(tid('login-code'), code);
  await page.click(tid('login-verify'));
  await page.waitForSelector(tid('screen-start'), { timeout: 30_000 });
}
/** Schliesst eine evtl. noch laufende Tour aus einem früheren Lauf (Testdaten bleiben konsistent). */
async function closeRunningTour(page) {
  await page.waitForTimeout(800);
  if (await page.locator(tid('tour-stop')).count()) {
    await page.click(tid('tour-stop'));
    const c = page.locator(tid('tour-close-catch')).or(page.locator(tid('tour-close-null')));
    await c.first().click();
    await page.getByText('Tour abgeschlossen').waitFor();
  }
}
/** In-App-Navigation über «Mehr» (wie ein Mensch; keine Neuladung der Seite). */
async function more(page, target) {
  const back = page.locator(`${tid('nav-back')} >> visible=true`);
  if (await back.count()) { await back.first().click(); await page.waitForTimeout(400); }
  await tab(page, 'Mehr');
  await page.locator(`${tid(`more-${target}`)} >> visible=true`).first().click();
}
async function tab(page, title) { await page.getByRole('tab', { name: title }).or(page.getByRole('link', { name: title })).first().click(); }
async function waitSynced(page, timeout = 30_000) {
  await page.waitForFunction(() => /Synchronisiert \d\d:\d\d/.test(document.body.innerText), null, { timeout });
}

// ---------------------------------------------------------------- Tests

test('1/5 Mitglied: Anmeldung im Demo-Modus, Offline-Status, Standort standardmässig aus', async () => {
  const { ctx, page } = await newPhone();
  await appLogin(page, 'mitglied@demo.fvw.invalid');
  await shot(page, '01-start-online');
  await ctx.setOffline(true);
  await page.getByText('Offline', { exact: false }).first().waitFor();
  assert.ok(await page.getByText(/Alle Eingaben werden sicher auf dem Gerät gespeichert/).isVisible());
  await shot(page, '02-start-offline');
  await ctx.setOffline(false);
  await tab(page, 'Karte');
  await page.waitForSelector(tid('screen-map'));
  assert.ok(await page.locator(tid('map-location-on')).isVisible(), 'Standort ist standardmässig aus');
  assert.equal(page.errors.length, 0, page.errors.join('\n'));
  await ctx.close();
});

test('6/7 Tour: starten, Fänge offline, Neustart, Pause, Stop mit Bestätigung, Sync ohne Duplikate', async () => {
  const { ctx, page } = await newPhone();
  await appLogin(page, 'mitglied@demo.fvw.invalid');
  await tab(page, 'Fischen');
  await closeRunningTour(page);
  await page.fill(tid('water-search'), 'Werdenberger Binnen');
  await page.click(tid('water-werdenberger-binnenkanal'));
  await page.getByText('Teile dieses Gewässers sind gesperrt').waitFor();
  await page.click(tid('tour-start'));
  await page.waitForSelector(tid('tour-timer'));
  // Fang 1 (online)
  await page.click(tid('species-Bachforelle'));
  await page.fill(tid('catch-length'), '31');
  await page.click(tid('disp-zurueckgesetzt'));
  await page.click(tid('catch-save'));
  await page.getByText('Bachforelle, 31 cm, zurückgesetzt – gespeichert').waitFor();
  // Ungültige Länge wird abgewiesen (technische Prüfung, kein Mindestmass)
  await page.click(tid('species-Hecht'));
  await page.fill(tid('catch-length'), '0');
  await page.click(tid('disp-entnommen'));
  await page.click(tid('catch-save'));
  await page.getByText(/zwischen 1 und 150 cm/).first().waitFor();
  // Fang 2 offline
  await ctx.setOffline(true);
  await page.click(tid('species-Äsche'));
  await page.fill(tid('catch-length'), '36');
  await page.click(tid('disp-entnommen'));
  await page.click(tid('catch-save'));
  await page.getByText(/Offline · \d+ ausstehend/).first().waitFor();
  await shot(page, '03-tour-offline');
  // «Neustart» ohne Verbindung zum Server (App-Dateien erreichbar, API blockiert)
  await ctx.setOffline(false);
  await ctx.route('http://localhost:8787/**', (r) => r.abort());
  await page.reload();
  await tab(page, 'Fischen').catch(() => {});
  await page.waitForSelector(tid('tour-timer'), { timeout: 30_000 });
  assert.ok(await page.getByText('Fänge dieser Tour (2)').isVisible(), 'beide Fänge nach Neustart vorhanden');
  // Pause / Weiter
  await page.click(tid('tour-pause'));
  await page.getByText('Pausiert').waitFor();
  await page.click(tid('tour-pause'));
  await page.getByText('Tour läuft').waitFor();
  // Stop mit Bestätigung
  await page.click(tid('tour-stop'));
  await page.getByText('Tour wirklich beenden?').waitFor();
  await shot(page, '04-tour-stop-bestaetigung');
  await page.click(tid('tour-close-catch'));
  await page.getByText(/Fangmeldung mit 2 Fängen/).waitFor();
  // Verbindung wieder da → automatische Synchronisation
  await ctx.unroute('http://localhost:8787/**');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitSynced(page, 60_000);
  const token = await apiLogin('mitglied@demo.fvw.invalid');
  const pull = await apiGet(token, '/app/sync/pull');
  const tour = pull.tours.filter((t) => t.status === 'closed' && t.outcome === 'catch').sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const catches = pull.catches.filter((c) => c.tourId === tour.id && !c.deleted);
  assert.equal(catches.length, 2, 'genau zwei Fänge – keine Duplikate');
  assert.equal(tour.pauses.length, 1);
  assert.equal(page.errors.length, 0, page.errors.join('\n'));
  await ctx.close();
});

test('6 Nullmeldung: Tour ohne Fang abschliessen', async () => {
  const { ctx, page } = await newPhone();
  await appLogin(page, 'jugend@demo.fvw.invalid');
  await tab(page, 'Fischen');
  await closeRunningTour(page);
  await page.fill(tid('water-search'), 'Voralpsee');
  await page.click(tid('water-voralpsee'));
  await page.click(tid('tour-start'));
  await page.click(tid('tour-stop'));
  await page.click(tid('tour-close-null'));
  await page.getByText(/Nullmeldung für «Voralpsee» gespeichert/).waitFor();
  await waitSynced(page);
  const token = await apiLogin('jugend@demo.fvw.invalid');
  const pull = await apiGet(token, '/app/sync/pull');
  assert.ok(pull.tours.some((t) => t.waterName === 'Voralpsee' && t.outcome === 'null_report' && t.status === 'closed'));
  await ctx.close();
});

test('3/4 Karte: passende Karte, Wechsel bei zwei Berechtigungen, offline mit gespeicherten Daten', async () => {
  const { ctx, page } = await newPhone();
  await appLogin(page, 'mitglied@demo.fvw.invalid');
  await tab(page, 'Karte');
  await page.waitForSelector(tid('map-group-jugend'));
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="water-map"] path').length > 50, null, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await shot(page, '05-karte-aktive');
  await page.click(tid('map-group-jugend'));
  await page.waitForTimeout(800);
  const nJugend = await page.locator(`${tid('water-map')} path`).count();
  assert.ok(nJugend > 20, 'Jugend-Karte gezeichnet');
  // Offline: API blockiert + Neuladen → Karte aus lokalem Speicher
  await ctx.route('http://localhost:8787/api/**', (r) => r.abort());
  await page.reload();
  await page.waitForSelector(tid('screen-map'), { timeout: 30_000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="water-map"] path').length > 20, null, { timeout: 30_000 });
  assert.ok(await page.locator(tid('map-version-label')).isVisible());
  await ctx.close();
});

test('10 Warnungen: gesperrter Bereich und ungeklärte Köderregel (Standort nur nach Zustimmung)', async () => {
  const { ctx, page } = await newPhone({ geolocation: { longitude: POINTS.closed.lon, latitude: POINTS.closed.lat, accuracy: 10 }, permissions: ['geolocation'] });
  await appLogin(page, 'vorstand@demo.fvw.invalid');
  await tab(page, 'Karte');
  await page.click(tid('map-location-on'));
  await page.getByText('Standort verwenden?').waitFor();
  await page.getByRole('button', { name: 'Zustimmen' }).click();
  await page.getByText('Gesperrter Bereich').waitFor({ timeout: 20_000 });
  assert.ok(await page.getByText(/kein verbindlicher Rechtsnachweis/).first().isVisible());
  await page.waitForTimeout(1000);
  await shot(page, '06-karte-gesperrt-warnung');
  await ctx.setGeolocation({ longitude: POINTS.unclear.lon, latitude: POINTS.unclear.lat, accuracy: 10 });
  await page.getByText('Regel ungeklärt').waitFor({ timeout: 20_000 });
  await page.getByText(/Vorstandsklärung erforderlich/).first().waitFor();
  await ctx.close();
});

test('8/9 Fangliste: Mitglied nur eigene, Admin «alle Mitglieder»; CSV mit Pflichtspalten', async () => {
  const m = await newPhone();
  await appLogin(m.page, 'mitglied@demo.fvw.invalid');
  await tab(m.page, 'Fangbuch');
  await m.page.waitForSelector(tid('screen-fangbuch'));
  assert.equal(await m.page.locator(tid('scope-all')).count(), 0, 'Mitglied hat keinen Schalter «alle»');
  await see(m.page, m.page.getByText(/^[1-9]\d* Fänge, davon \d+ entnommen$/));
  const [dl] = await Promise.all([m.page.waitForEvent('download'), m.page.click(tid('csv-export'))]);
  const csv = readFileSync(await dl.path(), 'utf8');
  assert.ok(csv.startsWith('\uFEFFDatum;Uhrzeit;Mitglied;Gewässer;Art;Länge;Entnommen'));
  assert.ok(/;Äsche;36;ja/.test(csv), 'Umlaute und Werte korrekt');
  await shot(m.page, '07-fangbuch-mitglied');
  await m.ctx.close();
  const a = await newPhone();
  await appLogin(a.page, 'vorstand@demo.fvw.invalid');
  await tab(a.page, 'Fangbuch');
  await a.page.click(tid('scope-all'));
  await a.page.getByText(/Demo Mitglied/).first().waitFor({ timeout: 20_000 });
  await shot(a.page, '08-fangbuch-admin-alle');
  await a.ctx.close();
});

test('2 Tageskarte: Gast weist gültige Berechtigung (QR) vor – auch offline', async () => {
  const { ctx, page } = await newPhone();
  await appLogin(page, 'gast@demo.fvw.invalid');
  await page.getByText(/Fangmeldung offen/).first().waitFor();
  await ctx.setOffline(true);
  await page.click(tid('dash-show-permit'));
  await page.waitForSelector(tid('screen-permit'));
  await page.locator(tid('permit-show-qr')).first().click();
  await page.getByLabel('QR-Code des Ausweises für die Kontrolle').waitFor();
  await shot(page, '09-tageskarte-ausweis-offline');
  await ctx.close();
});

test('12 News, Gewässerzustand und Termine im Demo-Modus', async () => {
  const a = await newPhone();
  await appLogin(a.page, 'vorstand@demo.fvw.invalid');
  await more(a.page, 'news');
  await a.page.click(tid('news-new'));
  await a.page.getByRole('radio', { name: 'Gewässerzustand' }).click();
  await a.page.getByLabel('Titel').fill('E2E: Trübung Voralpsee');
  await a.page.getByLabel('Text').fill('Nach starkem Regen trüb (Testmeldung).');
  await a.page.getByLabel('Gewässer (für Gewässerzustand)').fill('Voralp');
  await a.page.getByRole('button', { name: 'Voralpsee' }).click();
  await a.page.getByLabel('Trübung').fill('trüb');
  await a.page.getByRole('button', { name: 'Veröffentlichen' }).click();
  await a.page.locator('text=E2E: Trübung Voralpsee >> visible=true').first().waitFor();
  await a.ctx.close();
  const m = await newPhone();
  await appLogin(m.page, 'mitglied@demo.fvw.invalid');
  await more(m.page, 'news');
  await m.page.locator('text=E2E: Trübung Voralpsee >> visible=true').first().waitFor({ timeout: 20_000 });
  await m.page.getByText('abgelaufen – nicht mehr aktuell').first().waitFor();
  await shot(m.page, '10-news-gewaesserzustand');
  await more(m.page, 'termine');
  await see(m.page, m.page.locator('text=/Demo-Termin: Arbeitseinsatz/ >> visible=true').first());
  await m.page.locator('[role=button]:has-text("Anmelden") >> visible=true').first().click();
  await m.page.getByRole('button', { name: 'Anmeldung senden' }).click();
  await m.page.getByText(/Anmeldung wird übermittelt|Anmeldung übermittelt/).first().waitFor();
  await shot(m.page, '11-termine');
  await m.ctx.close();
});

test('13 Meldung Verschmutzung offline mit ausstehendem Versandstatus', async () => {
  const { ctx, page } = await newPhone();
  await appLogin(page, 'mitglied@demo.fvw.invalid');
  await more(page, 'meldung');
  await page.waitForSelector(tid('screen-report'));
  await ctx.setOffline(true);
  await page.fill(tid('report-desc'), 'E2E: Ölfilm unterhalb der Brücke');
  await page.click(tid('report-submit'));
  await page.getByText('Übermittlung ausstehend').first().waitFor();
  await shot(page, '12-meldung-offline-ausstehend');
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitSynced(page);
  await page.reload();
  await page.getByText(/Übermittelt \(E-Mail im Entwurfsmodus/).first().waitFor({ timeout: 30_000 });
  await ctx.close();
});

test('14 Aufseher: Kontrolle offline dokumentieren, Ausweis offline prüfen, synchronisieren', async () => {
  const guestToken = await apiLogin('gast@demo.fvw.invalid');
  const guestBoot = await apiGet(guestToken, '/app/bootstrap');
  const credential = guestBoot.permits.find((p) => p.currentlyValid).credentialToken;
  const { ctx, page } = await newPhone();
  await appLogin(page, 'aufseher@demo.fvw.invalid');
  await more(page, 'kontrolle');
  await page.waitForSelector(tid('screen-control'));
  await ctx.setOffline(true);
  await page.click(tid('control-start'));
  await page.fill(tid('control-manual'), credential);
  await page.click(tid('control-check'));
  await page.getByText('Gültig', { exact: true }).waitFor();
  await shot(page, '13-kontrolle-offline-gueltig');
  await page.fill(tid('control-manual'), credential.slice(0, -3) + 'AAA');
  await page.click(tid('control-check'));
  await page.getByText(/Signatur ungültig/).waitFor();
  await page.fill(tid('control-manual'), credential);
  await page.click(tid('control-check'));
  await page.click(tid('control-finish'));
  await page.getByText(/offline gespeichert/).waitFor();
  await page.getByText('wartet auf Upload').first().waitFor();
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await waitSynced(page);
  const adminToken = await apiLogin('vorstand@demo.fvw.invalid');
  const controls = await apiGet(adminToken, '/admin/controls');
  assert.ok(controls.controls.some((c) => c.credential_result === 'gueltig' && c.checked_person_name === 'Demo Gast'));
  await ctx.close();
});

test('17 Offene Entscheide und Integrationsstatus in der App sichtbar', async () => {
  const { ctx, page } = await newPhone();
  await appLogin(page, 'mitglied@demo.fvw.invalid');
  await more(page, 'status');
  await page.getByText(/Offene Vorstandsentscheide \(\d+\)/).waitFor({ timeout: 20_000 });
  await page.getByText(/O8: Welche Köder sind in der Ebene/).waitFor();
  await page.getByText('SMS-Code (Plan B)').waitFor();
  await shot(page, '14-status-entscheide-integrationen');
  await ctx.close();
});
