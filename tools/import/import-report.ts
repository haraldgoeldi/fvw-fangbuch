/**
 * Erzeugt aus den KML-Dateien den Importbericht (docs/02-importbericht.md) und die abgeleiteten
 * Kartendaten für die App (data/derived/2026/*.json).
 *   npx tsx tools/import/import-report.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXPECTED_LAYER_COUNTS, importMaps, MAP_GROUPS, renderImportReportMarkdown, type MapGroup } from '@fvw/shared';

const root = resolve(import.meta.dirname, '../..');
const src = resolve(root, 'data/source/2026/kml-live-abruf');
const files: Record<MapGroup, string> = { aktive: 'aktive-fischer-2026.kml', jugend: 'jugendfischer-2026.kml', tageskarte: 'tageskarte-2026.kml' };
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const inputs = MAP_GROUPS.map((g) => {
  const buf = readFileSync(resolve(src, files[g.key]));
  return { group: g.key, kml: buf.toString('utf8'), sha256: sha(buf), bytes: buf.length, expectedObjects: g.expectedObjects, expectedNames: g.expectedNames, expectedLayerCounts: EXPECTED_LAYER_COUNTS[g.key] };
});
const result = importMaps(inputs);
const md = renderImportReportMarkdown(result, {
  generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
  sourceLabel: 'Live-Abruf der My-Maps-Netzwerklinks am 15.11.2026 (siehe data/source/2026/kml-live-abruf/ABRUF.md)',
  sourceStatus: 'Live-Abruf, **noch nicht als geprüfte Basisversion bestätigt** (die vollständigen KML-Exporte wurden nicht mitgeliefert; die drei KMZ-Dateien enthalten nur Netzwerklinks).',
  files: inputs.map((i) => ({ group: i.group, file: `data/source/2026/kml-live-abruf/${files[i.group]}`, sha256: i.sha256, bytes: i.bytes })),
});
writeFileSync(resolve(root, 'docs/02-importbericht.md'), md);
const out = resolve(root, 'data/derived/2026');
mkdirSync(out, { recursive: true });
for (const g of MAP_GROUPS) {
  const sections = result.sections.filter((s) => s.group === g.key);
  const stats = result.stats.find((s) => s.group === g.key)!;
  writeFileSync(resolve(out, `map-${g.key}.json`), JSON.stringify({ group: g.key, title: g.title, sourceSha256: stats.sha256, sections }));
}
writeFileSync(resolve(out, 'waters.json'), JSON.stringify(result.waters, null, 1));
writeFileSync(resolve(out, 'issues.json'), JSON.stringify(result.issues, null, 1));
writeFileSync(resolve(out, 'stats.json'), JSON.stringify(result.stats, null, 1));
for (const f of ['map-aktive.json', 'map-jugend.json', 'map-tageskarte.json']) console.log(f, (statSync(resolve(out, f)).size / 1024).toFixed(0), 'KB');
console.log('Befunde:', result.issues.length, 'Gewässer:', result.waters.length, 'Abschnitte:', result.sections.length);
