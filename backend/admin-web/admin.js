/* Fangbuch Admin – einfache geschützte Weboberfläche (ohne Build-Schritt). Alle Rechte prüft das Backend. */
(function () {
  'use strict';
  const S = { token: null, me: null, demo: false, route: 'uebersicht' };
  try { S.token = sessionStorage.getItem('fvw_admin_token'); } catch (e) { /* ignorieren */ }
  const $ = (s) => document.querySelector(s);
  const main = () => $('#main');
  const mount = (...kids) => main().replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));

  // ---------------------------------------------------------------- Hilfen
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return el;
  }
  const fmt = (d) => (d ? new Date(d).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' }) : '–');
  const fmtDate = (d) => (d ? new Date(d.length === 10 ? d + 'T12:00:00Z' : d).toLocaleDateString('de-CH') : '–');
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3500); }
  async function api(path, opts = {}) {
    const headers = { ...(opts.body && !(opts.body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}) };
    const res = await fetch(`/api${path}`, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers, body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined });
    if (res.status === 401) { logout(); throw new Error('Sitzung abgelaufen'); }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((data && data.message) || `Fehler ${res.status}`);
    return data;
  }
  const modePill = (m) => h('span', { class: `pill ${{ active: 'ok', test: 'info', not_configured: 'warn', error: 'err' }[m] || ''}` }, { active: 'aktiv', test: 'Testmodus', not_configured: 'nicht eingerichtet', error: 'Fehler' }[m] || m);
  const statusPill = (s) => h('span', { class: `pill ${{ aktiv: 'ok', entwurf: 'warn', abgelehnt: 'err', archiviert: '', bestaetigt: 'ok', offen: 'warn', fehler: 'err', gesendet: 'ok', ausstehend: 'warn', ungeprueft: 'warn', entschieden: 'ok', gesperrt: 'err' }[s] || ''}` }, s);
  function table(cols, rows, empty = 'Keine Einträge.') {
    if (!rows.length) return h('p', { class: 'muted' }, empty);
    return h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, cols.map((c) => h('th', {}, c[0])))), h('tbody', {}, rows.map((r) => h('tr', {}, cols.map((c) => h('td', {}, c[1](r))))))));
  }
  const btn = (label, onclick, cls = '') => h('button', { class: `btn small ${cls}`, type: 'button', onclick: async (e) => { e.target.disabled = true; try { await onclick(); } catch (err) { toast(err.message); } finally { e.target.disabled = false; } } }, label);
  const groupLabel = { aktive: 'Aktive Fischer', jugend: 'Jugendfischer', tageskarte: 'Tageskarte' };
  const field = (label, input, hint) => h('div', {}, h('label', {}, label), input, hint ? h('div', { class: 'muted', style: 'font-size:13px' }, hint) : null);

  // ---------------------------------------------------------------- Anmeldung
  function logout() { S.token = null; try { sessionStorage.removeItem('fvw_admin_token'); } catch (e) { /* */ } renderLogin(); }
  function renderLogin() {
    $('#nav').hidden = true; $('#who').textContent = '';
    const email = h('input', { type: 'email', autocomplete: 'email', placeholder: 'name@beispiel.ch' });
    const code = h('input', { inputmode: 'numeric', maxlength: '6', placeholder: '6-stelliger Code' });
    const info = h('p', { class: 'muted' });
    const step2 = h('div', { hidden: true }, field('Code aus der E-Mail', code), h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn primary', onclick: verify }, 'Anmelden')));
    async function request() {
      try {
        await api('/auth/request-code', { body: { email: email.value } });
        info.textContent = 'Falls die E-Mail berechtigt ist, wurde ein Code gesendet.'; step2.hidden = false; code.focus();
        if (S.demo) {
          const mails = await api(`/demo/mailbox?email=${encodeURIComponent(email.value)}`);
          const m = mails[0] && /lautet: (\d{6})/.exec(mails[0].body);
          if (m) info.textContent = `Demo-Modus: Ihr Code lautet ${m[1]} (wird nicht per E-Mail versendet).`;
        }
      } catch (e) { toast(e.message); }
    }
    async function verify() {
      try {
        const r = await api('/auth/verify-code', { body: { email: email.value, code: code.value, device: 'Admin-Web' } });
        S.token = r.token; try { sessionStorage.setItem('fvw_admin_token', r.token); } catch (e) { /* */ }
        await start();
      } catch (e) { toast(e.message); }
    }
    mount(h('div', { class: 'login panel' }, h('h1', {}, 'Anmeldung Vorstand/Admin'),
      h('p', { class: 'muted' }, 'Anmeldung mit Einmal-Code an die in Fairgate hinterlegte E-Mail. Es gibt keine Passwörter.'),
      field('E-Mail', email), h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn primary', onclick: request }, 'Code anfordern')), info, step2,
      S.demo ? h('p', { class: 'note' }, 'Demo-Konto: vorstand@demo.fvw.invalid') : null));
  }

  // ---------------------------------------------------------------- Navigation
  const ROUTES = [
    ['Übersicht', [['uebersicht', 'Übersicht'], ['entscheide', 'Offene Entscheide']]],
    ['Karten & Regeln', [['karten', 'Kartenversionen'], ['befunde', 'Importbefunde'], ['regeln', 'Köderregeln'], ['sperrzeiten', 'Sperrzeiten'], ['gewaesser', 'Gewässer'], ['arten', 'Fischarten']]],
    ['Fangbuch', [['faenge', 'Fänge (alle)'], ['ruecklauf', 'Rücklaufquote'], ['konflikte', 'Sync-Konflikte']]],
    ['Patente & Personen', [['patente', 'Patentarten & Patente'], ['personen', 'Personen & Rollen']]],
    ['Inhalte', [['news', 'News & Gewässerzustand'], ['termine', 'Termine'], ['meldungen', 'Meldungen'], ['kontrollen', 'Kontrollen']]],
    ['Betrieb', [['integrationen', 'Integrationen'], ['postausgang', 'Postausgang'], ['einstellungen', 'Einstellungen'], ['datenschutz', 'Datenschutz & Löschung'], ['protokoll', 'Protokoll']]],
  ];
  function renderNav() {
    const nav = $('#nav'); nav.hidden = false;
    nav.replaceChildren(...ROUTES.flatMap(([sec, items]) => [h('div', { class: 'sep' }, sec), ...items.map(([id, label]) => h('a', { href: `#${id}`, class: S.route === id ? 'active' : '' }, label))]));
  }
  async function go() {
    S.route = (location.hash || '#uebersicht').slice(1).split('/')[0];
    renderNav();
    const view = VIEWS[S.route] || VIEWS.uebersicht;
    mount(h('p', { class: 'muted' }, 'Lade …'));
    try { await view(); } catch (e) { mount(h('div', { class: 'panel' }, h('h1', {}, 'Fehler'), h('p', {}, e.message))); }
  }

  // ---------------------------------------------------------------- Ansichten
  const VIEWS = {};
  VIEWS.uebersicht = async () => {
    const o = await api('/admin/overview');
    const c = o.counts;
    const kpis = [['Berechtigte Mitglieder', c.members], ['Gäste', c.guests], ['Touren', c.tours], ['Fänge', c.catches], ['Kontrollen', c.controls], ['Meldungen', c.reports]];
    const todos = [[c.water_suggestions, 'ungeprüfte Gewässervorschläge', 'gewaesser'], [c.conflicts, 'offene Sync-Konflikte', 'konflikte'], [c.deletion_requests, 'offene Löschanträge', 'datenschutz'], [c.open_decisions, 'offene Vorstandsentscheide', 'entscheide'], [c.mail_drafts, 'E-Mail-Entwürfe (nicht versendet)', 'postausgang'], [c.mail_errors, 'E-Mail-Fehler', 'postausgang']].filter((x) => Number(x[0]) > 0);
    mount(
      h('h1', {}, `Übersicht Saison ${o.season}`),
      h('div', { class: 'grid' }, kpis.map(([l, v]) => h('div', { class: 'kpi' }, h('b', {}, v), h('span', {}, l)))),
      h('h2', {}, 'Zu erledigen'), todos.length ? h('ul', {}, todos.map(([n, l, r]) => h('li', {}, h('a', { href: `#${r}` }, `${n} ${l}`)))) : h('p', { class: 'muted' }, 'Nichts offen.'),
      h('h2', {}, 'Gewässerkarten'),
      table([['Karte', (v) => groupLabel[v.map_group]], ['Status', (v) => statusPill(v.status)], ['Geprüfte Basis', (v) => (v.is_verified_base ? 'ja' : h('span', { class: 'pill warn' }, 'nein – Live-Abruf'))], ['Prüfsumme', (v) => h('span', { class: 'mono' }, v.sha256.slice(0, 16) + '…')], ['Aktiviert', (v) => fmt(v.activated_at)], ['Befunde', (v) => `${v.issue_counts.fehler || 0} F / ${v.issue_counts.warnung || 0} W / ${v.issue_counts.info || 0} I`]], o.versions),
      h('h3', {}, 'Letzte Aktualitätsprüfung (My Maps)'),
      table([['Karte', (x) => groupLabel[x.map_group]], ['Zeit', (x) => fmt(x.checked_at)], ['Ergebnis', (x) => statusPill(x.result)], ['Meldung', (x) => x.message || '']], o.checks, 'Noch keine Prüfung durchgeführt.'),
      h('h2', {}, 'Integrationen'),
      table([['Integration', (i) => i.label], ['Status', (i) => modePill(i.mode)], ['Detail', (i) => i.detail], ['Letzter Erfolg', (i) => fmt(i.last_success_at)], ['Letzter Fehler', (i) => (i.last_error ? `${fmt(i.last_error_at)}: ${i.last_error}` : '–')]], o.integrations),
    );
  };

  VIEWS.entscheide = async () => {
    const list = await api('/admin/decisions');
    mount(h('h1', {}, 'Offene Vorstandsentscheide'), h('p', { class: 'muted' }, 'Diese Punkte sind nicht beschlossen. Die App erfindet dafür keine Werte; die Spalte «Bis zur Entscheidung» beschreibt das aktuelle Verhalten.'),
      table([['ID', (d) => d.id], ['Frage', (d) => d.question], ['Bis zur Entscheidung', (d) => d.interim], ['Status', (d) => statusPill(d.status)], ['Entscheid', (d) => d.decision || '–'],
        ['', (d) => btn('Erfassen', async () => {
          const text = prompt(`Entscheid zu ${d.id} (leer = wieder offen):`, d.decision || '');
          if (text === null) return;
          await api(`/admin/decisions/${d.id}`, { method: 'PUT', body: { status: text.trim() ? 'entschieden' : 'offen', decision: text.trim() || null, decidedAt: text.trim() ? new Date().toISOString().slice(0, 10) : null } });
          toast('Gespeichert. Hinweis: Regeln/Einstellungen separat anpassen.'); go();
        })]], list));
  };

  VIEWS.karten = async () => {
    const d = await api('/admin/maps');
    const file = h('input', { type: 'file', accept: '.kml,.kmz' });
    const group = h('select', {}, Object.entries(groupLabel).map(([k, v]) => h('option', { value: k }, v)));
    const note = h('input', { placeholder: 'Notiz (optional)' });
    mount(
      h('h1', {}, `Kartenversionen ${d.season}`),
      h('div', { class: 'note' }, 'Die drei bereitgestellten KMZ-Dateien enthalten nur Netzwerklinks. Die aktiven Versionen stammen aus dem Live-Abruf vom 15.11.2026 und sind noch nicht als geprüfte Basis bestätigt. Geprüfte KML-Exporte hier hochladen und «als geprüfte Basis aktivieren».'),
      h('h2', {}, 'Quellen (Netzwerklinks)'),
      table([['Karte', (s) => groupLabel[s.map_group]], ['Titel', (s) => s.title], ['My-Maps-ID', (s) => h('span', { class: 'mono' }, s.my_maps_id || '–')], ['Aktiv', (s) => (s.active ? 'ja' : 'nein')],
        ['', (s) => btn('Bearbeiten', async () => {
          const id = prompt('My-Maps-ID (leer = keine automatische Prüfung):', s.my_maps_id || ''); if (id === null) return;
          await api(`/admin/maps/sources/${s.id}`, { method: 'PUT', body: { title: s.title, myMapsId: id.trim() || null, active: s.active } }); go();
        })]], d.sources),
      h('div', { class: 'row', style: 'margin:10px 0' }, btn('Jetzt alle Netzwerklinks prüfen', async () => { const r = await api('/admin/maps/check', { body: {} }); toast(r.map((x) => `${groupLabel[x.group]}: ${x.result}`).join(' · ')); go(); }, 'primary'),
        btn('Neue Saison / Quelle erfassen', async () => {
          const year = Number(prompt('Saison (Jahr):', String(d.season + 1))); if (!year) return;
          const g = prompt('Karte (aktive | jugend | tageskarte):', 'aktive'); if (!g) return;
          const t = prompt('Titel:', `${groupLabel[g]} ${year} Gewässerkarte`); const mid = prompt('My-Maps-ID (optional):', '');
          await api('/admin/maps/sources', { body: { seasonYear: year, group: g, title: t, myMapsId: mid || null } }); toast('Quelle erfasst. Saison unter Einstellungen umstellen, sobald die Karten bereit sind.');
        })),
      h('h2', {}, 'Datei importieren (KML/KMZ)'),
      h('div', { class: 'panel form' }, field('Karte', group), field('Datei', file), field('Notiz', note),
        h('div', { class: 'row', style: 'margin-top:10px' }, btn('Importieren (als Entwurf)', async () => {
          if (!file.files[0]) throw new Error('Bitte Datei wählen');
          const fd = new FormData(); fd.set('group', group.value); fd.set('file', file.files[0]); fd.set('note', note.value);
          const r = await api('/admin/maps/upload', { body: fd });
          toast(r.duplicate ? 'Identische Version existiert bereits (gleiche Prüfsumme).' : 'Entwurf gespeichert – bitte Bericht prüfen.'); location.hash = `#version/${r.id}`;
        }, 'primary'))),
      h('h2', {}, 'Versionen'),
      table([['Karte', (v) => groupLabel[v.map_group]], ['Status', (v) => statusPill(v.status)], ['Quelle', (v) => `${v.source}${v.source_name ? ` (${v.source_name})` : ''}`], ['Objekte', (v) => v.objects], ['Prüfsumme SHA-256', (v) => h('span', { class: 'mono' }, v.sha256)],
        ['Erstellt', (v) => fmt(v.created_at)], ['Geprüfte Basis', (v) => (v.is_verified_base ? 'ja' : 'nein')], ['', (v) => h('div', { class: 'row' }, h('a', { href: `#version/${v.id}`, class: 'btn small' }, 'Bericht & Vorschau'))]], d.versions),
      h('h2', {}, 'Prüfprotokoll'),
      table([['Zeit', (x) => fmt(x.checked_at)], ['Karte', (x) => groupLabel[x.map_group]], ['Ergebnis', (x) => statusPill(x.result)], ['Prüfsumme', (x) => h('span', { class: 'mono' }, (x.sha256 || '').slice(0, 16))], ['Meldung', (x) => x.message || '']], d.checks),
      h('div', { class: 'row' }, Object.keys(groupLabel).map((g) => btn(`Rückkehr zur letzten gültigen Version: ${groupLabel[g]}`, async () => {
        if (!confirm(`Vorherige gültige Version von «${groupLabel[g]}» wieder aktivieren?`)) return;
        await api('/admin/maps/rollback', { body: { group: g } }); toast('Vorherige Version aktiv.'); go();
      }, 'danger'))),
    );
  };

  VIEWS.version = async () => {
    const id = location.hash.split('/')[1];
    const r = await api(`/admin/maps/versions/${id}/report`);
    const v = r.version, s = r.stats;
    const svg = previewSvg(r.preview);
    mount(
      h('p', {}, h('a', { href: '#karten' }, '← Kartenversionen')),
      h('h1', {}, `${groupLabel[v.group]} – Version vom ${fmt(v.createdAt)}`),
      h('div', { class: 'row' }, statusPill(v.status), v.verifiedBase ? h('span', { class: 'pill ok' }, 'geprüfte Basis') : h('span', { class: 'pill warn' }, 'nicht als geprüfte Basis bestätigt')),
      h('p', {}, 'Prüfsumme: ', h('span', { class: 'mono' }, v.sha256), ` · ${(v.bytes / 1024).toFixed(0)} KB · Quelle ${v.source}${v.note ? ` · ${v.note}` : ''}`),
      h('div', { class: 'grid' }, [['Objekte', `${s.objects}${s.expectedObjects != null ? ` / Soll ${s.expectedObjects}` : ''}`], ['Gewässernamen', `${s.distinctNames}${s.expectedNames != null ? ` / Soll ${s.expectedNames}` : ''}`], ['Ebenen', s.layers.length], ['Gewässercodes', s.codes.join(', ')]].map(([l, x]) => h('div', { class: 'kpi' }, h('b', { style: 'font-size:18px' }, x), h('span', {}, l)))),
      h('h2', {}, 'Vorschau'), svg,
      r.diffToActive ? h('div', {}, h('h2', {}, 'Unterschiede zur aktiven Version'), h('p', {}, `${r.diffToActive.added.length} neue/geänderte Abschnitte, ${r.diffToActive.removed.length} entfallen.`),
        table([['Änderung', (x) => x.t], ['Name', (x) => x.name], ['Ebene', (x) => x.layer]], [...r.diffToActive.added.map((x) => ({ ...x, t: 'neu/geändert' })), ...r.diffToActive.removed.map((x) => ({ ...x, t: 'entfällt' }))].slice(0, 200))) : null,
      h('h2', {}, 'Ebenen'),
      table([['Ebene', (l) => l.name || '(ohne Namen)'], ['Bedeutung', (l) => l.ruleLabel], ['Objekte', (l) => `${l.objects}${l.expectedObjects != null ? ` / Soll ${l.expectedObjects}` : ''}`], ['Punkte/Linien/Flächen', (l) => `${l.geometry.Point}/${l.geometry.LineString}/${l.geometry.Polygon}`]], s.layers),
      h('h2', {}, `Importbefunde (${r.issues.length})`), issuesTable(r.issues, false),
      h('div', { class: 'row', style: 'margin-top:14px' },
        v.status !== 'aktiv' ? btn('Aktivieren', async () => { await api(`/admin/maps/versions/${id}/activate`, { body: { verifiedBase: false } }); toast('Aktiviert'); go(); }, 'primary') : null,
        btn('Als geprüfte Basis aktivieren', async () => { if (!confirm('Bestätigen Sie, dass diese Version die geprüfte Kartengrundlage ist?')) return; await api(`/admin/maps/versions/${id}/activate`, { body: { verifiedBase: true } }); toast('Als geprüfte Basis aktiv'); go(); }),
        v.status === 'entwurf' ? btn('Ablehnen', async () => { await api(`/admin/maps/versions/${id}/reject`, { body: {} }); go(); }, 'danger') : null),
    );
  };

  function previewSvg(items) {
    let minX = 180, minY = 90, maxX = -180, maxY = -90;
    const walk = (g, f) => { if (g.type === 'Point') f(g.coordinates); else if (g.type === 'LineString') g.coordinates.forEach(f); else if (g.type === 'Polygon') g.coordinates.forEach((r) => r.forEach(f)); else (g.geometries || []).forEach((x) => walk(x, f)); };
    items.forEach((s) => walk(s.geometry, (p) => { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }));
    const k = Math.cos((minY + maxY) / 2 * Math.PI / 180);
    const W = 1000, H = 1000 * (maxY - minY) / ((maxX - minX) * k || 1);
    const X = (lon) => ((lon - minX) / (maxX - minX)) * W, Y = (lat) => H - ((lat - minY) / (maxY - minY)) * H;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `-10 -10 ${W + 20} ${H + 20}`); svg.setAttribute('class', 'preview');
    for (const s of items) {
      const color = s.closed ? '#B3362D' : s.kind === 'lease_boundary' ? '#000' : s.kind === 'mountain_valley_boundary' ? '#7a5' : s.color || '#1F5C70';
      const draw = (g) => {
        if (g.type === 'Point') { const c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', X(g.coordinates[0])); c.setAttribute('cy', Y(g.coordinates[1])); c.setAttribute('r', 8); c.setAttribute('fill', '#E0A100'); svg.append(c); return; }
        if (g.type === 'GeometryCollection') return g.geometries.forEach(draw);
        const rings = g.type === 'Polygon' ? g.coordinates : [g.coordinates];
        for (const r of rings) { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', r.map((c, i) => `${i ? 'L' : 'M'}${X(c[0]).toFixed(1)},${Y(c[1]).toFixed(1)}`).join('') + (g.type === 'Polygon' ? 'Z' : '')); p.setAttribute('fill', g.type === 'Polygon' ? color + '55' : 'none'); p.setAttribute('stroke', color); p.setAttribute('stroke-width', s.kind === 'water' ? 2.2 : 1.5); if (s.kind !== 'water') p.setAttribute('stroke-dasharray', '8 6'); const t = document.createElementNS(ns, 'title'); t.textContent = s.name; p.append(t); svg.append(p); }
      };
      draw(s.geometry);
    }
    return svg;
  }

  function issuesTable(issues, editable) {
    const sev = { fehler: 'err', warnung: 'warn', info: 'info' };
    return table([['Schwere', (i) => h('span', { class: `pill ${sev[i.severity]}` }, i.severity)], ['Befund', (i) => h('div', {}, h('div', {}, i.title), h('div', { class: 'muted', style: 'font-size:13px' }, i.note, i.decisionRef ? ` (${i.decisionRef})` : ''))],
      ['Karten', (i) => i.maps.map((g) => groupLabel[g]).join(', ')], ['Original', (i) => h('span', { class: 'mono' }, i.original || '–')], ['Vorschlag', (i) => i.suggestion || '–'], ['Status', (i) => statusPill(i.status)],
      ['', (i) => (editable && i.normalizable ? h('div', { class: 'row' },
        btn('Bestätigen', async () => {
          let value = null;
          if (!i.suggestion) { value = prompt('Kein automatischer Vorschlag. Richtigen Wert eintragen:', ''); if (!value) return; }
          await api(`/admin/maps/issues/${encodeURIComponent(i.id)}/decision`, { body: { status: 'bestaetigt', value } }); toast('Bestätigt und protokolliert'); go();
        }), btn('Ablehnen', async () => { await api(`/admin/maps/issues/${encodeURIComponent(i.id)}/decision`, { body: { status: 'abgelehnt' } }); go(); }),
        i.status !== 'offen' ? btn('Zurücksetzen', async () => { await api(`/admin/maps/issues/${encodeURIComponent(i.id)}/decision`, { body: { status: 'offen' } }); go(); }) : null) : editable ? h('span', { class: 'muted', style: 'font-size:12px' }, 'nur Hinweis') : null)]], issues);
  }

  VIEWS.befunde = async () => {
    const d = await api('/admin/maps/issues');
    mount(h('h1', {}, 'Importbefunde (aktive Karten)'),
      h('p', { class: 'muted' }, 'Quelldaten werden nie stillschweigend verändert. Eine Bestätigung übernimmt den Vorschlag als Anzeigewert; der Originalwert bleibt gespeichert. Jede Entscheidung wird protokolliert. Am besten die Korrekturen zusätzlich in Google My Maps vornehmen.'),
      issuesTable(d.issues, true));
  };

  VIEWS.regeln = async () => {
    const rules = await api('/admin/rules');
    mount(h('h1', {}, 'Köderregeln je Ebene'), h('p', { class: 'muted' }, 'Die Ebene in My Maps bestimmt grundsätzlich die Köderregel. Texte und Status können nach Vorstandsentscheid angepasst werden (versioniert, protokolliert).'),
      table([['Ebene', (r) => r.kind], ['Anzeige', (r) => h('div', {}, h('b', {}, r.label), h('div', { class: 'muted', style: 'font-size:13px' }, r.meaning))], ['Status', (r) => statusPill({ from_source: 'aus Quelle', needs_board: 'Vorstandsklärung', imported_text_only: 'nur importierter Text', display_only: 'nur Darstellung' }[r.status] || r.status)],
        ['Fischen erlaubt', (r) => (r.fishingAllowed === null ? 'offen/n. a.' : r.fishingAllowed ? 'ja' : 'nein')], ['Version', (r) => r.version || 'Start'], ['Entscheid', (r) => r.decisionRef || ''],
        ['', (r) => h('div', { class: 'row' }, btn('Bearbeiten', () => editRule(r)), r.version ? btn('Auf Startwert', async () => { await api(`/admin/rules/${r.kind}`, { method: 'DELETE' }); go(); }) : null)]], rules));
  }
  function editRule(r) {
    const label = h('input', { value: r.label }), meaning = h('textarea', {}, r.meaning);
    const status = h('select', {}, [['from_source', 'aus Quelle/beschlossen'], ['needs_board', 'Vorstandsklärung erforderlich'], ['imported_text_only', 'nur importierter Text'], ['display_only', 'nur Darstellung']].map(([k, v]) => h('option', { value: k, selected: k === r.status }, v)));
    const allowed = h('select', {}, [['null', 'offen / nicht anwendbar'], ['true', 'ja'], ['false', 'nein']].map(([k, v]) => h('option', { value: k, selected: String(r.fishingAllowed) === k }, v)));
    mount(h('p', {}, h('a', { href: '#regeln', onclick: () => go() }, '← Köderregeln')), h('h1', {}, `Regel bearbeiten: ${r.kind}`), h('div', { class: 'panel form' }, field('Anzeige (kurz)', label), field('Bedeutung', meaning), field('Status', status), field('Fischen erlaubt', allowed),
      h('div', { class: 'row', style: 'margin-top:10px' }, btn('Speichern', async () => { await api(`/admin/rules/${r.kind}`, { method: 'PUT', body: { label: label.value, meaning: meaning.value, status: status.value, fishingAllowed: JSON.parse(allowed.value) } }); toast('Gespeichert'); location.hash = '#regeln'; go(); }, 'primary'))));
  }

  VIEWS.sperrzeiten = async () => {
    const [list, waters] = await Promise.all([api('/admin/closures'), api('/admin/waters')]);
    const water = h('select', {}, h('option', { value: '' }, '– Gewässer wählen –'), waters.fromMaps.map((w) => h('option', { value: w.key }, w.name)));
    const from = h('input', { type: 'date' }), to = h('input', { type: 'date' }), reason = h('input', { placeholder: 'Grund / Beschluss' });
    const groups = h('select', {}, h('option', { value: '' }, 'alle Karten'), Object.entries(groupLabel).map(([k, v]) => h('option', { value: k }, v)));
    mount(h('h1', {}, 'Strukturierte Sperrzeiten'),
      h('div', { class: 'note' }, 'Freitexte aus den Kartendaten (z. B. Simmi Tal «ist bis 30.04. gesperrt») werden NICHT automatisch übernommen – Beginn und Jahr fehlen. Sperrzeiten bitte nach Vorstandsentscheid hier mit Von- und Bis-Datum erfassen (O10).'),
      h('div', { class: 'panel form' }, field('Gewässer (alle Abschnitte)', water), field('Karten', groups), h('div', { class: 'row' }, field('Von', from), field('Bis', to)), field('Grund', reason),
        h('div', { class: 'row', style: 'margin-top:10px' }, btn('Sperrzeit erfassen', async () => { await api('/admin/closures', { body: { waterKey: water.value || null, sectionIds: [], groups: groups.value ? [groups.value] : null, from: from.value, to: to.value, reason: reason.value } }); toast('Erfasst'); go(); }, 'primary'))),
      table([['Gewässer', (c) => (waters.fromMaps.find((w) => w.key === c.waterKey) || {}).name || c.waterKey || `${c.sectionIds.length} Abschnitte`], ['Von', (c) => fmtDate(c.from)], ['Bis', (c) => fmtDate(c.to)], ['Karten', (c) => (c.groups ? c.groups.map((g) => groupLabel[g]).join(', ') : 'alle')], ['Grund', (c) => c.reason], ['Status', (c) => statusPill(c.status)],
        ['', (c) => c.status !== 'revoked' ? btn('Widerrufen', async () => { await api(`/admin/closures/${c.id}`, { method: 'PUT', body: { waterKey: c.waterKey, sectionIds: c.sectionIds, groups: c.groups, from: c.from, to: c.to, reason: c.reason, status: 'revoked' } }); go(); }, 'danger') : null]], list));
  };

  VIEWS.gewaesser = async () => {
    const d = await api('/admin/waters');
    mount(h('h1', {}, 'Gewässer'),
      h('h2', {}, 'Von Personen erfasste Gewässer'), h('p', { class: 'muted' }, 'Neue Gewässer sind «ungeprüft» und nur für die erfassende Person sichtbar, bis der Vorstand sie bestätigt.'),
      table([['Name', (w) => w.name], ['Status', (w) => statusPill(w.status)], ['Erfasst von', (w) => w.suggested_by_name || '–'], ['Erfasst', (w) => fmt(w.created_at)], ['Notiz', (w) => w.note || ''],
        ['', (w) => w.status === 'ungeprueft' ? h('div', { class: 'row' }, btn('Bestätigen', async () => { const n = prompt('Name bestätigen/korrigieren:', w.name); if (!n) return; await api(`/admin/waters/${encodeURIComponent(w.key)}/decision`, { body: { status: 'bestaetigt', name: n } }); go(); }), btn('Ablehnen', async () => { await api(`/admin/waters/${encodeURIComponent(w.key)}/decision`, { body: { status: 'abgelehnt' } }); go(); }, 'danger')) : null]], d.suggestions, 'Keine Vorschläge.'),
      h('h2', {}, `Gewässer aus den aktiven Karten (${d.fromMaps.length})`),
      table([['Name', (w) => w.name], ['Karten', (w) => w.groups.map((g) => groupLabel[g]).join(', ')], ['Codes', (w) => w.codes.join(', ') || '–'], ['Abschnitte', (w) => w.sectionIds.length], ['Gesperrte Abschnitte', (w) => (w.hasClosedSection ? 'ja' : '')]], d.fromMaps));
  };

  VIEWS.arten = async () => {
    const list = await api('/admin/species');
    const name = h('input', { placeholder: 'Neue Fischart' });
    mount(h('h1', {}, 'Fischarten'), h('p', { class: 'muted' }, 'Startwerte gemäss Anforderungsdokument. Deaktivierte Arten erscheinen nicht mehr bei der Erfassung, bestehende Fänge bleiben erhalten.'),
      h('div', { class: 'row panel' }, name, btn('Hinzufügen', async () => { await api('/admin/species', { body: { name: name.value } }); go(); }, 'primary')),
      table([['Name', (s) => s.name], ['Aktiv', (s) => (s.active ? 'ja' : 'nein')], ['Reihenfolge', (s) => s.sort], ['', (s) => btn(s.active ? 'Deaktivieren' : 'Aktivieren', async () => { await api(`/admin/species/${s.id}`, { method: 'PUT', body: { active: !s.active, sort: s.sort } }); go(); })]], list));
  };

  VIEWS.faenge = async () => {
    const from = h('input', { type: 'date' }), to = h('input', { type: 'date' }), species = h('input', { placeholder: 'Art (optional)' });
    const out = h('div');
    const qs = () => new URLSearchParams({ scope: 'all', ...(from.value ? { from: from.value } : {}), ...(to.value ? { to: to.value } : {}), ...(species.value ? { species: species.value } : {}) }).toString();
    async function load() {
      const rows = await api(`/app/catches?${qs()}`);
      out.replaceChildren(h('p', {}, `${rows.length} Fänge, davon ${rows.filter((r) => r.disposition === 'entnommen').length} entnommen`),
        table([['Zeit', (c) => fmt(c.caughtAt)], ['Mitglied', (c) => c.member], ['Gewässer', (c) => c.waterName], ['Art', (c) => c.species], ['Länge', (c) => `${c.lengthCm} cm`], ['Verbleib', (c) => (c.disposition === 'entnommen' ? 'entnommen' : 'zurückgesetzt')], ['Version', (c) => c.version]], rows));
    }
    mount(h('h1', {}, 'Fänge aller Mitglieder'), h('div', { class: 'row panel' }, field('Von', from), field('Bis', to), field('Art', species),
      btn('Filtern', load, 'primary'), btn('CSV herunterladen', async () => {
        const res = await fetch(`/api/app/catches.csv?${qs()}`, { headers: { Authorization: `Bearer ${S.token}` } });
        if (!res.ok) throw new Error('Export fehlgeschlagen');
        const blob = await res.blob(); const a = h('a', { href: URL.createObjectURL(blob), download: 'faenge-alle.csv' }); document.body.append(a); a.click(); a.remove();
      })), out);
    await load();
  };

  VIEWS.ruecklauf = async () => {
    const r = await api('/admin/returns');
    const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)} %`);
    mount(h('h1', {}, `Rücklaufquote Saison ${r.season}`),
      r.seasonAssumption ? h('div', { class: 'note' }, `Saisonbeginn/-ende nicht festgelegt (O26): berechnet für ${fmtDate(r.from)} – ${fmtDate(r.to)} (Kalenderjahr als Annahme).`) : null,
      h('div', { class: 'note' }, r.note),
      h('div', { class: 'grid' }, h('div', { class: 'kpi' }, h('b', {}, pct(r.dayCards.rate)), h('span', {}, `Tageskarten: ${r.dayCards.reported} von ${r.dayCards.total} mit Meldung (inkl. Nullmeldung)`)), h('div', { class: 'kpi' }, h('b', {}, pct(r.seasonPermits.rate)), h('span', {}, `Patente: ${r.seasonPermits.reported} von ${r.seasonPermits.total} mit Saisonmeldung`))),
      h('h2', {}, 'Pro Patentart'),
      table([['Patentart', (g) => h('span', {}, g.typeName, g.isDemo ? h('span', { class: 'pill warn', style: 'margin-left:6px' }, 'Demo') : null)], ['Art', (g) => g.kind], ['Quote', (g) => pct(g.rate)], ['Gemeldet', (g) => `${g.reported}/${g.total}`], ['Davon noch offen (laufend)', (g) => g.pending],
        ['Fehlende Meldungen', (g) => (g.missing.length ? h('details', {}, h('summary', {}, `${g.missing.length} anzeigen`), h('ul', {}, g.missing.map((m) => h('li', {}, `${m.person} – ${fmtDate(m.validFrom)}${m.validTo !== m.validFrom ? ` bis ${fmtDate(m.validTo)}` : ''}${m.stillOpen ? ' (noch laufend)' : ''}`)))) : '–')]], r.byType));
  };

  VIEWS.konflikte = async () => {
    const list = await api('/admin/conflicts');
    mount(h('h1', {}, 'Synchronisationskonflikte'), h('p', { class: 'muted' }, 'Kein Stand geht verloren: Bei Konflikten werden Geräte- und Serverstand gespeichert. Automatisch gelöste Fälle (eigene Änderungen) sind nur zur Nachvollziehbarkeit aufgeführt.'),
      table([['Zeit', (k) => fmt(k.created_at)], ['Person', (k) => k.display_name], ['Datensatz', (k) => `${k.entity} ${k.entity_id.slice(0, 8)}`], ['Gerät', (k) => h('pre', { class: 'mono' }, JSON.stringify(k.client_data, null, 1))], ['Server', (k) => h('pre', { class: 'mono' }, JSON.stringify(k.server_data, null, 1).slice(0, 400))], ['Lösung', (k) => k.resolution || h('span', { class: 'pill warn' }, 'offen')],
        ['', (k) => !k.resolved_at ? h('div', { class: 'row' }, btn('Gerätestand übernehmen', async () => { await api(`/admin/conflicts/${k.id}/resolve`, { body: { use: 'client' } }); go(); }), btn('Serverstand behalten', async () => { await api(`/admin/conflicts/${k.id}/resolve`, { body: { use: 'server' } }); go(); })) : null]], list));
  };

  VIEWS.patente = async () => {
    const [types, permits, persons] = await Promise.all([api('/admin/permit-types'), api('/admin/permits'), api('/admin/persons')]);
    const t = { name: h('input'), kind: h('select', {}, ['saison', 'tag', 'spezial'].map((k) => h('option', { value: k }, k))), group: h('select', {}, h('option', { value: '' }, '– keine –'), Object.entries(groupLabel).map(([k, v]) => h('option', { value: k }, v))), status: h('select', {}, ['vorschlag', 'aktiv', 'archiviert'].map((k) => h('option', { value: k }, k))), ticket: h('input', { placeholder: 'Eventfrog-Ticketart (exakter Name, optional)' }) };
    const p = { person: h('select', {}, persons.persons.filter((x) => !x.anonymized_at).map((x) => h('option', { value: x.id }, `${x.display_name} (${x.kind === 'guest' ? 'Gast' : x.member_no || 'Mitglied'})`))), type: h('select', {}, types.map((x) => h('option', { value: x.id }, x.name))), from: h('input', { type: 'date' }), to: h('input', { type: 'date' }), pay: h('input', { value: 'unbekannt' }) };
    mount(h('h1', {}, 'Patentarten & Patente'),
      h('div', { class: 'note' }, 'Die Patentverwaltung ist noch nicht beschlossen (AD §2: Vorschlag). Es sind keine Patentarten, Preise, Gültigkeiten oder Kaufbedingungen vorgegeben (O1, O2). Demo-Patentarten sind entsprechend markiert. Die App verkauft nichts und wickelt keine Zahlungen ab.'),
      h('h2', {}, 'Patentarten'),
      table([['Name', (x) => h('span', {}, x.name, x.is_demo ? h('span', { class: 'pill warn', style: 'margin-left:6px' }, 'Demo') : null)], ['Art', (x) => x.kind], ['Karte', (x) => groupLabel[x.map_group] || '–'], ['Status', (x) => statusPill(x.status)], ['Eventfrog-Ticketart', (x) => x.eventfrog_ticket_type || '–'],
        ['', (x) => btn('Status ändern', async () => { const s = prompt('Status (vorschlag | aktiv | archiviert):', x.status); if (!s) return; await api(`/admin/permit-types/${x.id}`, { method: 'PUT', body: { name: x.name, kind: x.kind, mapGroup: x.map_group, status: s, eventfrogTicketType: x.eventfrog_ticket_type, description: x.description } }); go(); })]], types),
      h('details', { class: 'panel' }, h('summary', {}, 'Neue Patentart erfassen'), h('div', { class: 'form' }, field('Name', t.name), field('Art', t.kind), field('Kartengruppe', t.group, 'Bestimmt, welche Gewässerkarte die Person sieht.'), field('Status', t.status), field('Eventfrog-Ticketart', t.ticket),
        h('div', { class: 'row', style: 'margin-top:10px' }, btn('Speichern', async () => { await api('/admin/permit-types', { body: { name: t.name.value, kind: t.kind.value, mapGroup: t.group.value || null, status: t.status.value, eventfrogTicketType: t.ticket.value || null } }); go(); }, 'primary')))),
      h('h2', {}, 'Patente'),
      h('details', { class: 'panel' }, h('summary', {}, 'Patent ausstellen'), h('div', { class: 'form' }, field('Person', p.person), field('Patentart', p.type), h('div', { class: 'row' }, field('Gültig ab', p.from), field('Gültig bis', p.to)), field('Zahlungsstatus (Freitext)', p.pay),
        h('div', { class: 'row', style: 'margin-top:10px' }, btn('Ausstellen', async () => { await api('/admin/permits', { body: { personId: p.person.value, permitTypeId: p.type.value, validFrom: p.from.value, validTo: p.to.value, paymentStatus: p.pay.value } }); go(); }, 'primary')))),
      table([['Person', (x) => `${x.display_name}${x.person_kind === 'guest' ? ' (Gast)' : ''}`], ['Patentart', (x) => x.type_name], ['Gültig', (x) => `${fmtDate(x.valid_from)} – ${fmtDate(x.valid_to)}`], ['Status', (x) => statusPill(x.status)], ['Zahlung', (x) => x.payment_status], ['Quelle', (x) => x.source], ['Ausweis-Nr.', (x) => h('span', { class: 'mono' }, x.credential_code)],
        ['', (x) => h('div', { class: 'row' }, btn(x.status === 'gesperrt' ? 'Entsperren' : 'Sperren', async () => { await api(`/admin/permits/${x.id}`, { method: 'PUT', body: { status: x.status === 'gesperrt' ? 'aktiv' : 'gesperrt', validTo: x.valid_to, paymentStatus: x.payment_status, note: x.note } }); go(); }, x.status === 'gesperrt' ? '' : 'danger'),
          btn('Verlängern', async () => { const d = prompt('Neues Gültig-bis (JJJJ-MM-TT):', x.valid_to); if (!d) return; await api(`/admin/permits/${x.id}`, { method: 'PUT', body: { status: x.status, validTo: d, paymentStatus: x.payment_status, note: x.note } }); go(); }))]], permits));
  };

  VIEWS.personen = async () => {
    const d = await api('/admin/persons');
    const roleLabel = { member: 'Mitglied', warden: 'Aufseher', admin: 'Vorstand/Admin', guest: 'Gast' };
    mount(h('h1', {}, 'Personen & Rollen'),
      h('p', { class: 'muted' }, `Mitgliederdaten kommen aus Fairgate (führende Quelle) und werden hier nicht gepflegt. Rollenquelle: «${d.roleSource === 'fairgate' ? 'Fairgate-Gruppe' : 'in der App gepflegt'}» (O23, unter Einstellungen änderbar).`),
      h('div', { class: 'row', style: 'margin-bottom:10px' }, btn('Fairgate-Abgleich jetzt', async () => { const r = await api('/admin/integrations/fairgate/run', { body: {} }); toast(r.message || `${r.total} Kontakte`); go(); }), btn('Eventfrog-Abgleich jetzt', async () => { const r = await api('/admin/integrations/eventfrog/run', { body: {} }); toast(r.message || `${r.total} Bestellungen`); go(); })),
      table([['Name', (p) => p.display_name], ['Art', (p) => (p.kind === 'guest' ? 'Gast' : 'Mitglied')], ['E-Mail', (p) => p.email || '–'], ['Nr.', (p) => p.member_no || '–'], ['Fairgate-Status', (p) => p.fairgate_status || '–'], ['Zugang', (p) => (p.anonymized_at ? 'anonymisiert' : p.eligible ? statusPill('aktiv') : statusPill('gesperrt'))], ['Rollen', (p) => p.effectiveRoles.map((r) => roleLabel[r]).join(', ')], ['Zusatzrechte', (p) => p.extra_permissions.join(', ') || '–'],
        ['', (p) => p.anonymized_at ? null : h('div', { class: 'row' },
          p.kind === 'member' ? btn('Rollen', async () => {
            const r = prompt('Rollen (warden, admin – kommagetrennt, leer = nur Mitglied):', p.roles.join(', ')); if (r === null) return;
            const extra = prompt(`Zusatzrechte (z. B. news.write, catches.read_all):\nVerfügbar: ${d.permissions.join(', ')}`, p.extra_permissions.join(', ')); if (extra === null) return;
            const res = await api(`/admin/persons/${p.id}/roles`, { method: 'PUT', body: { roles: r.split(',').map((x) => x.trim()).filter(Boolean), extraPermissions: extra.split(',').map((x) => x.trim()).filter(Boolean), revokedPermissions: p.revoked_permissions } });
            toast(res.note || 'Gespeichert und protokolliert'); go();
          }) : null,
          p.kind === 'member' && p.eligible ? btn('Zugangscode (ohne E-Mail)', async () => { const r = await api(`/admin/persons/${p.id}/access-code`, { body: {} }); alert(`Einmal-Zugangscode: ${r.code}\nGültig ${r.validDays} Tage. Bitte persönlich übergeben.`); }) : null,
          btn('Sitzungen beenden', async () => { const r = await api(`/admin/persons/${p.id}/revoke-sessions`, { body: {} }); toast(`${r.revoked} Sitzung(en) beendet`); }))]], d.persons));
  };

  VIEWS.news = async () => {
    const [list, waters] = await Promise.all([api('/admin/news'), api('/admin/waters')]);
    const f = { title: h('input'), body: h('textarea'), category: h('select', {}, [['allgemein', 'Allgemein'], ['gewaesserzustand', 'Gewässerzustand'], ['verein', 'Verein'], ['sperrung', 'Sperrung']].map(([k, v]) => h('option', { value: k }, v))),
      water: h('select', {}, h('option', { value: '' }, '– kein Gewässer –'), waters.fromMaps.map((w) => h('option', { value: w.key }, w.name))), level: h('input', { placeholder: 'z. B. normal / hoch' }), turb: h('input', { placeholder: 'z. B. klar / trüb' }), ice: h('input', { placeholder: 'z. B. eisfrei' }), closure: h('input', { placeholder: 'Sperrung (Text)' }),
      vis: h('select', {}, h('option', { value: 'alle' }, 'Alle (inkl. Tageskarten)'), h('option', { value: 'mitglieder' }, 'Nur Mitglieder')), expires: h('input', { type: 'datetime-local' }), important: h('input', { type: 'checkbox', style: 'width:auto;min-height:0' }) };
    mount(h('h1', {}, 'News & Gewässerzustand'),
      h('details', { class: 'panel', open: true }, h('summary', {}, 'Neuer Beitrag'), h('div', { class: 'form' }, field('Titel', f.title), field('Text', f.body), field('Kategorie', f.category), field('Gewässer (für Gewässerzustand)', f.water),
        h('div', { class: 'row' }, field('Wasserstand', f.level), field('Trübung', f.turb), field('Eis', f.ice)), field('Sperrung', f.closure), field('Sichtbar für', f.vis), field('Ablaufdatum (optional)', f.expires, 'Abgelaufene Meldungen werden als «abgelaufen» gekennzeichnet und nicht als aktuelle Lage gezeigt.'),
        h('label', { style: 'display:flex;gap:8px;align-items:center' }, f.important, 'Wichtig (Push nur, wenn Push eingerichtet und in den Einstellungen aktiviert)'),
        h('div', { class: 'row', style: 'margin-top:10px' }, btn('Veröffentlichen', async () => {
          const w = waters.fromMaps.find((x) => x.key === f.water.value);
          await api('/admin/news', { body: { title: f.title.value, body: f.body.value, category: f.category.value, waterKey: w ? w.key : null, waterName: w ? w.name : null,
            condition: f.category.value === 'gewaesserzustand' ? { waterLevel: f.level.value || null, turbidity: f.turb.value || null, ice: f.ice.value || null, closureNote: f.closure.value || null } : null,
            visibility: f.vis.value, expiresAt: f.expires.value ? new Date(f.expires.value).toISOString() : null, important: f.important.checked } });
          toast('Veröffentlicht'); go();
        }, 'primary')))),
      table([['Datum', (n) => fmt(n.publishedAt)], ['Titel', (n) => n.title], ['Kategorie', (n) => n.category], ['Gewässer', (n) => n.waterName || '–'], ['Sichtbar', (n) => n.visibility], ['Ablauf', (n) => (n.expiresAt ? h('span', {}, fmt(n.expiresAt), n.expired ? h('span', { class: 'pill warn', style: 'margin-left:6px' }, 'abgelaufen') : null) : '–')],
        ['', (n) => btn('Löschen', async () => { if (!confirm('Beitrag löschen?')) return; await api(`/admin/news/${n.id}`, { method: 'DELETE' }); go(); }, 'danger')]], list));
  };

  VIEWS.termine = async () => {
    const list = await api('/admin/events');
    mount(h('h1', {}, 'Termine'), h('p', { class: 'muted' }, 'Termine werden nicht doppelt gepflegt: das Backend liest sie von der Vereinswebseite (iCal/RSS bevorzugt; Seite auslesen ist störanfälliger). Quelle und Status unter Integrationen.'),
      h('div', { class: 'row', style: 'margin-bottom:10px' }, btn('Jetzt einlesen', async () => { const r = await api('/admin/integrations/website/run', { body: {} }); toast(r.message || `${r.count} Termine`); go(); })),
      table([['Datum', (e) => fmt(e.starts_at)], ['Titel', (e) => e.title], ['Ort', (e) => e.location || '–'], ['Quelle', (e) => e.source], ['Anmeldungen', (e) => e.registrations], ['Link', (e) => (e.url ? h('a', { href: e.url, target: '_blank', rel: 'noopener' }, 'Detail') : '–')], ['Entfernt', (e) => (e.removed_at ? fmt(e.removed_at) : '')]], list));
  };

  VIEWS.meldungen = async () => {
    const list = await api('/admin/reports');
    mount(h('h1', {}, 'Meldungen (Verschmutzung, tote Fische)'),
      table([['Zeit', (r) => fmt(r.observed_at)], ['Art', (r) => r.kind], ['Gewässer', (r) => r.water_name || '–'], ['Beschreibung', (r) => r.description], ['Standort', (r) => (r.location ? h('a', { href: `https://map.geo.admin.ch/?swisssearch=${r.location.lat},${r.location.lon}`, target: '_blank', rel: 'noopener' }, 'Karte') : 'nicht übermittelt')], ['Fotos', (r) => r.photo_ids.length], ['Person', (r) => r.display_name], ['Versand', (r) => (r.mail_status ? h('span', {}, statusPill(r.mail_status), ` ${r.to_addr}`) : 'nur Admin')]], list));
  };

  VIEWS.kontrollen = async () => {
    const d = await api('/admin/controls');
    mount(h('h1', {}, 'Kontrollen der Aufseher'), h('div', { class: 'note' }, 'Kontroll- und Vergehensdaten sind besonders schützenswert. Jeder Abruf wird protokolliert. Es erfolgt kein automatischer Versand an Behörden. Aufbewahrungsfrist: Einstellungen (O25).'),
      table([['Beginn', (c) => fmt(c.started_at)], ['Aufseher', (c) => c.warden_name], ['Gewässer', (c) => c.water_name || '–'], ['Ausweis', (c) => (c.credential_code ? h('span', { class: 'mono' }, c.credential_code) : '–')], ['Ergebnis', (c) => c.credential_result || '–'], ['Kontrollierte Person', (c) => c.checked_person_name || c.checked_person_label || '–'], ['Bestätigung', (c) => (c.confirmation ? c.confirmation.method : 'keine')], ['Status', (c) => statusPill(c.status)], ['Notiz', (c) => c.notes || '']], d.controls),
      h('h2', {}, 'Mögliche Vergehen'),
      table([['Zeit', (v) => fmt(v.created_at)], ['Aufseher', (v) => v.warden_name], ['Vorname', (v) => v.first_name || '–'], ['Nachname', (v) => v.last_name || '–'], ['Beschreibung', (v) => v.description], ['Fotos', (v) => v.photo_ids.length]], d.violations));
  };

  VIEWS.integrationen = async () => {
    const d = await api('/admin/integrations');
    mount(h('h1', {}, 'Integrationen'), h('p', { class: 'muted' }, 'Integrationen gelten nur als funktionsfähig, wenn Zugangsdaten, Freigaben und Endpunkte vorliegen. Zugangsdaten liegen ausschliesslich im Backend (.env).'),
      table([['Integration', (i) => i.label], ['Status', (i) => modePill(i.mode)], ['Detail', (i) => i.detail], ['Letzter Erfolg', (i) => fmt(i.last_success_at)], ['Letzter Fehler', (i) => (i.last_error ? `${fmt(i.last_error_at)}: ${i.last_error}` : '–')],
        ['', (i) => ['fairgate', 'eventfrog', 'website', 'mymaps', 'mail'].includes(i.key) ? btn('Jetzt ausführen', async () => { const r = await api(`/admin/integrations/${i.key}/run`, { body: {} }); toast(JSON.stringify(r).slice(0, 160)); go(); }) : null]], d.status),
      h('h2', {}, 'Fehler- und Ereignisprotokoll'),
      table([['Zeit', (l) => fmt(l.at)], ['Integration', (l) => l.key], ['Stufe', (l) => statusPill(l.level)], ['Meldung', (l) => l.message]], d.logs));
  };

  VIEWS.postausgang = async () => {
    const [mail, push] = await Promise.all([api('/admin/outbox/mail'), api('/admin/outbox/push')]);
    mount(h('h1', {}, 'Postausgang'), h('p', { class: 'muted' }, 'Im Entwurfsmodus werden Nachrichten nur hier gespeichert und NICHT versendet.'),
      h('h2', {}, 'E-Mails'), table([['Zeit', (m) => fmt(m.created_at)], ['Art', (m) => m.kind], ['An', (m) => m.to_addr], ['Betreff', (m) => m.subject], ['Status', (m) => statusPill(m.status)], ['Inhalt', (m) => (m.kind === 'otp' ? h('span', { class: 'muted' }, '(Anmeldecode – ausgeblendet)') : h('details', {}, h('summary', {}, 'anzeigen'), h('pre', { style: 'white-space:pre-wrap' }, m.body)))]], mail),
      h('h2', {}, 'Push-Nachrichten'), table([['Zeit', (m) => fmt(m.created_at)], ['Titel', (m) => m.title], ['Zielgruppe', (m) => m.audience], ['Status', (m) => statusPill(m.status)]], push));
  };

  VIEWS.einstellungen = async () => {
    const [list, seasons] = await Promise.all([api('/admin/settings'), api('/admin/seasons')]);
    const groups = [...new Set(list.map((s) => s.group))];
    const render = (s) => {
      let input;
      if (s.type === 'bool') input = h('select', {}, h('option', { value: 'true', selected: s.value === true }, 'ja'), h('option', { value: 'false', selected: s.value === false }, 'nein'));
      else if (s.type === 'enum') input = h('select', {}, s.options.map((o) => h('option', { value: o, selected: s.value === o }, o)));
      else if (s.type === 'string[]') input = h('input', { value: (s.value || []).join(', '), placeholder: s.options ? s.options.join(', ') : '' });
      else input = h('input', { value: s.value == null ? '' : s.value, placeholder: 'nicht festgelegt', type: s.type === 'int' ? 'number' : 'text' });
      const save = btn('Speichern', async () => {
        let v = input.value;
        if (s.type === 'bool') v = v === 'true'; else if (s.type === 'int') v = v === '' ? null : Number(v); else if (s.type === 'string[]') v = v.split(',').map((x) => x.trim()).filter(Boolean); else if (v === '') v = null;
        await api(`/admin/settings/${s.key}`, { method: 'PUT', body: { value: v } }); toast('Gespeichert (versioniert, protokolliert)'); go();
      }, 'primary');
      return h('div', { class: 'panel' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', {}, s.label), h('span', {}, s.value == null || (Array.isArray(s.value) && !s.value.length) ? h('span', { class: 'pill warn' }, 'nicht festgelegt') : null, s.decisionRef ? h('span', { class: 'pill info', style: 'margin-left:6px' }, `offen ${s.decisionRef}`) : null, s.technical ? h('span', { class: 'pill', style: 'margin-left:6px' }, 'technisch') : null)),
        h('div', { class: 'muted', style: 'font-size:14px;margin:4px 0 8px' }, s.description), h('div', { class: 'row' }, h('div', { style: 'flex:1;min-width:220px' }, input), save), h('div', { class: 'muted', style: 'font-size:12px;margin-top:4px' }, s.isDefault ? 'Startwert' : `Version ${s.version}, geändert ${fmt(s.updatedAt)}`));
    };
    mount(h('h1', {}, 'Einstellungen'),
      ...groups.flatMap((g) => [h('h2', {}, g), ...list.filter((s) => s.group === g).map(render)]),
      h('h2', {}, 'Saisons'), table([['Jahr', (s) => s.year], ['Beginn', (s) => fmtDate(s.starts_on)], ['Ende', (s) => fmtDate(s.ends_on)], ['Notiz', (s) => s.note || ''],
        ['', (s) => btn('Bearbeiten', async () => { const a = prompt('Saisonbeginn (JJJJ-MM-TT, leer = nicht festgelegt):', s.starts_on || ''); if (a === null) return; const b = prompt('Saisonende (JJJJ-MM-TT):', s.ends_on || ''); if (b === null) return; await api(`/admin/seasons/${s.year}`, { method: 'PUT', body: { label: s.label, startsOn: a || null, endsOn: b || null } }); go(); })]], seasons));
  };

  VIEWS.datenschutz = async () => {
    const list = await api('/admin/deletion-requests');
    const out = h('pre', { class: 'mono' });
    mount(h('h1', {}, 'Datenschutz & Löschung'),
      h('h2', {}, 'Löschanträge'), table([['Eingang', (d) => fmt(d.requested_at)], ['Person', (d) => d.display_name], ['Art', (d) => d.kind], ['Status', (d) => statusPill(d.status)], ['Notiz', (d) => d.note || ''],
        ['', (d) => d.status === 'offen' ? h('div', { class: 'row' }, btn('Anonymisieren', async () => { const n = prompt('Begründung/Prüfung (Aufbewahrungspflichten berücksichtigt?):'); if (!n) return; await api(`/admin/deletion-requests/${d.id}/process`, { body: { action: 'anonymize', note: n } }); go(); }, 'danger'), btn('Ablehnen', async () => { const n = prompt('Begründung:'); if (!n) return; await api(`/admin/deletion-requests/${d.id}/process`, { body: { action: 'reject', note: n } }); go(); })) : null]], list),
      h('h2', {}, 'Löschfristen anwenden'), h('p', { class: 'muted' }, 'Fristen unter Einstellungen (Gäste, Aufbewahrung). Ohne festgelegte Frist wird nichts gelöscht. Gäste: Personendaten werden gelöscht, Fangdaten bleiben anonymisiert.'),
      h('div', { class: 'row' }, btn('Probelauf', async () => { out.textContent = JSON.stringify(await api('/admin/retention/run', { body: { dryRun: true } }), null, 2); }), btn('Jetzt anwenden', async () => { if (!confirm('Löschfristen jetzt anwenden? Dies kann nicht rückgängig gemacht werden.')) return; out.textContent = JSON.stringify(await api('/admin/retention/run', { body: { dryRun: false } }), null, 2); }, 'danger')), out);
  };

  VIEWS.protokoll = async () => {
    const list = await api('/admin/audit?limit=500');
    mount(h('h1', {}, 'Protokoll (Adminaktionen, Importe, Regel- und Berechtigungsänderungen)'),
      table([['Zeit', (a) => fmt(a.at)], ['Wer', (a) => a.actor_label || 'System'], ['Aktion', (a) => a.action], ['Objekt', (a) => `${a.entity || ''} ${a.entity_id ? String(a.entity_id).slice(0, 12) : ''}`], ['Details', (a) => (a.details ? h('details', {}, h('summary', {}, 'anzeigen'), h('pre', { class: 'mono', style: 'white-space:pre-wrap' }, JSON.stringify(a.details, null, 1))) : '')]], list));
  };

  // ---------------------------------------------------------------- Start
  async function start() {
    try {
      const me = await api('/app/bootstrap');
      if (!me.me.permissions.includes('admin.access')) { mount(h('div', { class: 'panel login' }, h('h1', {}, 'Kein Zugriff'), h('p', {}, 'Ihr Konto hat keine Berechtigung für den Adminbereich.'), h('button', { class: 'btn', onclick: logout }, 'Abmelden'))); return; }
      S.me = me.me;
      $('#who').replaceChildren(h('span', {}, `${S.me.displayName} · Vorstand/Admin`), h('button', { class: 'btn small', onclick: async () => { await api('/auth/logout', { body: {} }).catch(() => {}); logout(); } }, 'Abmelden'));
      window.onhashchange = go;
      await go();
    } catch (e) { renderLogin(); }
  }
  (async () => {
    try { const cfg = await (await fetch('/api/public/config')).json(); S.demo = cfg.demoMode; $('#demo-banner').hidden = !cfg.demoMode; } catch (e) { /* */ }
    if (S.token) await start(); else renderLogin();
  })();
})();
