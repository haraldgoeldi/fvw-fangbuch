// Rauchtest der Admin-Weboberfläche: Anmeldung (Demo), alle Ansichten laden ohne JavaScript-Fehler, Screenshots nach docs/screenshots.
// node e2e/admin-web.smoke.cjs
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || require('path').resolve(__dirname, '../docs/screenshots');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto('http://localhost:8787/admin/');
  await p.fill('input[type=email]', 'vorstand@demo.fvw.invalid');
  await p.click('text=Code anfordern');
  await p.waitForSelector('text=Ihr Code lautet');
  const code = (await p.textContent('p.muted:has-text("Ihr Code lautet")')).match(/(\d{6})/)[1];
  await p.fill('input[inputmode=numeric]', code);
  await p.click('button:has-text("Anmelden")');
  await p.waitForSelector('h1:has-text("Übersicht")');
  await p.screenshot({ path: `${out}/admin-uebersicht.png`, fullPage: true });
  for (const r of ['karten', 'befunde', 'regeln', 'sperrzeiten', 'gewaesser', 'faenge', 'ruecklauf', 'patente', 'personen', 'news', 'termine', 'meldungen', 'kontrollen', 'integrationen', 'postausgang', 'einstellungen', 'entscheide', 'datenschutz', 'protokoll', 'konflikte', 'arten']) {
    await p.goto(`http://localhost:8787/admin/#${r}`);
    await p.waitForTimeout(700);
    const h1 = await p.textContent('main h1').catch(() => '?');
    console.log(r, '->', h1);
    if (['karten', 'befunde', 'einstellungen', 'ruecklauf'].includes(r)) await p.screenshot({ path: `${out}/admin-${r}.png`, fullPage: false });
  }
  await p.goto('http://localhost:8787/admin/#karten'); await p.waitForTimeout(600);
  await p.click('a:has-text("Bericht & Vorschau")'); await p.waitForTimeout(1200);
  console.log('version ->', await p.textContent('main h1'));
  await p.screenshot({ path: `${out}/admin-version.png`, fullPage: false });
  console.log('ERRORS', JSON.stringify(errors));
  if (errors.length) process.exitCode = 1;
  await b.close();
})();
