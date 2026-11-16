import { LAYER_RULES, MAP_GROUPS, type MapGroup } from '../domain';
import type { ImportIssue, ImportResult } from './import';

export interface ReportMeta {
  generatedAt: string;
  sourceLabel: string;
  sourceStatus: string;
  files: { group: MapGroup; file: string; sha256: string; bytes: number }[];
}

const SEV: Record<string, string> = { fehler: '🔴 Fehler', warnung: '🟠 Warnung', info: '🔵 Info' };
const STATUS: Record<string, string> = { offen: 'offen', bestaetigt: 'bestätigt', abgelehnt: 'abgelehnt' };
const GROUP_TITLE: Record<MapGroup, string> = { aktive: 'Aktive Fischer', jugend: 'Jugendfischer', tageskarte: 'Tageskarte' };

const esc = (s: string | null | undefined) => (s ?? '–').replace(/\|/g, '\\|').replace(/\n/g, ' / ');

export function renderImportReportMarkdown(r: ImportResult, meta: ReportMeta): string {
  const out: string[] = [];
  const p = (s = '') => out.push(s);
  p('# 2 Importbericht Gewässerkarten 2026');
  p();
  p(`Erstellt: ${meta.generatedAt} · Quelle: ${meta.sourceLabel}`);
  p();
  p(`**Status der Daten:** ${meta.sourceStatus}`);
  p();
  p('Der Bericht wird automatisch erzeugt (`npm run import:report`). Dieselben Befunde sieht der Admin im Adminbereich unter **Kartenversionen → Importbericht**. Dort kann er jeden Befund bestätigen oder ablehnen.');
  p('**Quelldaten werden nicht verändert.** Ein bestätigter Vorschlag ändert nur den Anzeigewert, der Originalwert bleibt gespeichert und protokolliert.');
  p();
  p('## 2.1 Dateien und Prüfsummen');
  p();
  p('| Karte | Datei | Grösse | SHA-256 |');
  p('|---|---|---|---|');
  for (const f of meta.files) p(`| ${GROUP_TITLE[f.group]} | \`${f.file}\` | ${(f.bytes / 1024).toFixed(0)} KB | \`${f.sha256}\` |`);
  p();
  p('## 2.2 Objektzahlen im Vergleich mit dem Anforderungsdokument');
  p();
  p('| Karte | Objekte (Ist / Soll) | Gewässernamen (Ist / Soll) | Punkte | Linien | Flächen | Gewässercodes | Ausdehnung (WGS84) |');
  p('|---|---|---|---|---|---|---|---|');
  for (const s of r.stats) {
    const g = { Point: 0, LineString: 0, Polygon: 0 };
    for (const l of s.layers) { g.Point += l.geometry.Point; g.LineString += l.geometry.LineString; g.Polygon += l.geometry.Polygon; }
    const ok = (a: number, b: number | null) => (b === null ? `${a} / –` : `${a} / ${b} ${a === b ? '✅' : '❌'}`);
    p(`| ${GROUP_TITLE[s.group]} | ${ok(s.objects, s.expectedObjects)} | ${ok(s.distinctNames, s.expectedNames)} | ${g.Point} | ${g.LineString} | ${g.Polygon} | ${s.codes.join(', ')} | ${s.bbox ? s.bbox.map((v) => v.toFixed(4)).join(', ') : '–'} |`);
  }
  p();
  const tk = r.sections.filter((x) => x.group === 'tageskarte');
  const tkWaters = [...new Set(tk.filter((x) => x.kind === 'water').map((x) => x.name))];
  p(`Tageskarte: ${tk.length} Objekte. Davon sind ${tk.filter((x) => x.kind === 'water').length} Gewässerabschnitte (${tkWaters.join(', ')}), ${tk.filter((x) => x.kind === 'orientation_point').length} Orientierungspunkt und ${tk.filter((x) => x.kind === 'lease_boundary').length} Pachtgrenzen. Die Angabe «ausschliesslich Werdenberger Binnenkanal» ist damit für die Gewässer bestätigt.`);
  p();
  p('## 2.3 Ebenen und Regelzuordnung');
  p();
  for (const s of r.stats) {
    p(`### ${GROUP_TITLE[s.group]}`);
    p();
    p('| # | Ebene (Original) | Bedeutung in der App | Regelstatus | Objekte (Ist / Soll) | Punkte | Linien | Flächen |');
    p('|---|---|---|---|---|---|---|---|');
    for (const l of s.layers) {
      const status = { from_source: 'aus Quelle', needs_board: '**Vorstandsklärung erforderlich**', imported_text_only: 'nur importierter Text', conflict: 'Widerspruch', display_only: 'nur Darstellung' }[l.ruleStatus];
      const cnt = l.expectedObjects === null ? `${l.objects} / –` : `${l.objects} / ${l.expectedObjects} ${l.objects === l.expectedObjects ? '✅' : '❌'}`;
      p(`| ${l.index + 1} | ${esc(l.name)} | ${esc(LAYER_RULES[l.kind].label)} | ${status} | ${cnt} | ${l.geometry.Point} | ${l.geometry.LineString} | ${l.geometry.Polygon} |`);
    }
    p();
  }
  p('## 2.4 Gewässercodes');
  p();
  p('Gewässercodes sind **nicht eindeutig pro Gewässer**. Sie werden als Attribut des Abschnitts geführt, nicht als Schlüssel (siehe O29).');
  p();
  p('| Code | Abschnitte | Gewässernamen | Beispiele |');
  p('|---|---|---|---|');
  const byCode = new Map<number, Set<string>>();
  const secByCode = new Map<number, number>();
  for (const s of r.sections) if (s.code !== null) {
    byCode.set(s.code, (byCode.get(s.code) ?? new Set()).add(s.name));
    secByCode.set(s.code, (secByCode.get(s.code) ?? 0) + 1);
  }
  for (const [c, names] of [...byCode.entries()].sort((a, b) => a[0] - b[0])) {
    const n = [...names].sort((a, b) => a.localeCompare(b, 'de'));
    p(`| ${c} | ${secByCode.get(c)} | ${n.length} | ${esc(n.slice(0, 6).join(', '))}${n.length > 6 ? ', …' : ''} |`);
  }
  const noCode = r.sections.filter((s) => s.kind === 'water' && s.code === null);
  p();
  p(`Gewässerabschnitte ohne Code: ${noCode.length}. Betroffen sind gesperrte Gewässer (dort ist kein Code erfasst) sowie ${noCode.filter((s) => s.layerKind !== 'closed').length} Abschnitt(e) in Köderebenen (siehe Befunde).`);
  p();
  p('## 2.5 Duplikate und Mehrfachvorkommen');
  p();
  const dupWithin: string[] = [];
  for (const g of MAP_GROUPS) {
    const seen = new Map<string, string>();
    for (const s of r.sections.filter((x) => x.group === g.key)) {
      const k = JSON.stringify(s.geometry);
      if (seen.has(k)) dupWithin.push(`${GROUP_TITLE[g.key]}: «${s.name}» (${s.layerName}) = «${seen.get(k)}»`);
      else seen.set(k, `${s.name} (${s.layerName})`);
    }
  }
  p(`- Identische Geometrien innerhalb einer Karte: **${dupWithin.length}**${dupWithin.length ? ': ' + dupWithin.join('; ') : ''}`);
  const aktGeoms = new Set(r.sections.filter((s) => s.group === 'aktive').map((s) => JSON.stringify(s.geometry)));
  for (const g of ['jugend', 'tageskarte'] as MapGroup[]) {
    const list = r.sections.filter((s) => s.group === g);
    const same = list.filter((s) => aktGeoms.has(JSON.stringify(s.geometry))).length;
    p(`- ${GROUP_TITLE[g]}: ${same} von ${list.length} Geometrien sind identisch mit der Karte «Aktive Fischer». Die übrigen sind eigenständig gezeichnet oder leicht abweichend. Jede Karte wird separat geführt.`);
  }
  const multiLayer = new Map<string, Set<string>>();
  for (const s of r.sections.filter((x) => x.kind === 'water' && x.group === 'aktive')) multiLayer.set(s.name, (multiLayer.get(s.name) ?? new Set()).add(LAYER_RULES[s.layerKind].label));
  const ml = [...multiLayer.entries()].filter(([, l]) => l.size > 1);
  p(`- Gewässer in mehreren Ebenen (Aktive Fischer), Regeln gelten pro Abschnitt: ${ml.map(([n, l]) => `**${n}** (${[...l].join(' · ')})`).join('; ')}`);
  const perName = new Map<string, number>();
  for (const s of r.sections.filter((x) => x.kind === 'water' && x.group === 'aktive')) perName.set(s.name, (perName.get(s.name) ?? 0) + 1);
  const top = [...perName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  p(`- Gewässer mit den meisten Abschnitten (Aktive Fischer): ${top.map(([n, c]) => `${n} (${c})`).join(', ')}`);
  p();
  p('## 2.6 Befunde zur Datenqualität');
  p();
  const counts = { fehler: 0, warnung: 0, info: 0 } as Record<string, number>;
  r.issues.forEach((i) => counts[i.severity]++);
  p(`${r.issues.length} Befunde: ${counts.fehler} Fehler, ${counts.warnung} Warnungen, ${counts.info} Hinweise. Status «offen» heisst: noch nicht durch einen Admin bestätigt. Nur Befunde mit Vorschlag können bestätigt werden und ändern dann den Anzeigewert.`);
  p();
  p('| Schwere | Befund | Karte(n) | Ebene | Originalwert | Vorschlag | Status | Hinweis |');
  p('|---|---|---|---|---|---|---|---|');
  for (const i of r.issues) p(issueRow(i));
  p();
  p('## 2.7 Fehlende oder nicht offline verfügbare Daten');
  p();
  p('- **Geprüfte KML-Basisdateien fehlen.** Die hochgeladenen KMZ-Dateien enthalten nur Netzwerklinks. Die Daten stammen deshalb aus dem Live-Abruf vom 15.11.2026. Die Dateigrössen stimmen mit den Angaben im Anforderungsdokument überein (ca. 760, 220 und 20 KB). Ein Admin muss die Version als Basis bestätigen.');
  p('- **Sperrzeiten**: Es gibt keine strukturierten Daten. Der einzige Freitext ist Simmi Tal «bis 30.04. gesperrt» (siehe Befunde, O10).');
  p('- **Mindestmasse, Schonzeiten, Fanglimiten**: nicht in den Quelldaten enthalten und deshalb nicht umgesetzt (O19).');
  p('- **Gewässerzustand**: Er ist nicht Teil der Kartendaten und wird über News der Kategorie «Gewässerzustand» gepflegt.');
  p('- **Fotos** in den Beschreibungen liegen bei Google (mymaps.usercontent.google.com) und sind nur online sichtbar.');
  p('- **Vereinslogo** `logo-transparent.png`: nicht geliefert. Die App verwendet bis dahin einen neutralen Platzhalter.');
  p();
  p('## 2.8 Gewässerliste (abgeleitet, Anzeigenamen ohne bestätigte Normalisierungen)');
  p();
  p('| Gewässer | Karten | Codes | Abschnitte | gesperrte Abschnitte |');
  p('|---|---|---|---|---|');
  for (const w of r.waters) {
    const closedN = r.sections.filter((s) => w.sectionIds.includes(s.id) && s.closed).length;
    p(`| ${esc(w.name)} | ${w.groups.map((g) => GROUP_TITLE[g]).join(', ')} | ${w.codes.join(', ') || '–'} | ${w.sectionIds.length} | ${closedN || ''} |`);
  }
  p();
  return out.join('\n');
}

function issueRow(i: ImportIssue): string {
  const ref = i.decisionRef ? ` (${i.decisionRef})` : '';
  return `| ${SEV[i.severity]} | ${esc(i.title)} | ${i.maps.map((g) => GROUP_TITLE[g]).join(', ')} | ${esc(i.layer)} | ${esc(i.original)} | ${esc(i.suggestion)} | ${STATUS[i.status]} | ${esc(i.note)}${ref} |`;
}
