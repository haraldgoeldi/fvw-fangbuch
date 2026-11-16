import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_LAYER_COUNTS, importMaps, MAP_GROUPS, parseKml, type MapImportInput } from '../src';

const dir = resolve(__dirname, '../../../data/source/2026');
const files: Record<string, string> = { aktive: 'aktive-fischer-2026.kml', jugend: 'jugendfischer-2026.kml', tageskarte: 'tageskarte-2026.kml' };
const inputs: MapImportInput[] = MAP_GROUPS.map((g) => ({
  group: g.key, kml: readFileSync(resolve(dir, 'kml-live-abruf', files[g.key]), 'utf8'),
  expectedObjects: g.expectedObjects, expectedNames: g.expectedNames, expectedLayerCounts: EXPECTED_LAYER_COUNTS[g.key],
}));

describe('KMZ mit Netzwerklink', () => {
  it('erkennt Netzwerklink ohne Kartendaten', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(readFileSync(resolve(dir, 'kmz-netzwerklinks', 'Aktive Fischer 2026 Gewässerkarte.kmz')));
    const kml = await zip.file('doc.kml')!.async('string');
    const doc = parseKml(kml);
    expect(doc.networkLinkOnly).toBe(true);
    expect(doc.networkLinks[0].href).toContain('mid=1ix9IEIuiCC-A4pySRwl-xYhhiiOMXf8');
  });
});

describe('Kartenimport 2026', () => {
  const r = importMaps(inputs);
  it('stimmt mit den Prüfzahlen des Anforderungsdokuments überein', () => {
    const s = Object.fromEntries(r.stats.map((x) => [x.group, x]));
    expect(s.aktive.objects).toBe(355);
    expect(s.aktive.distinctNames).toBe(152);
    expect(s.jugend.objects).toBe(110);
    expect(s.jugend.distinctNames).toBe(67);
    expect(s.tageskarte.objects).toBe(10);
    expect(r.issues.filter((i) => i.kind === 'count_mismatch' || i.kind === 'layer_count_mismatch')).toEqual([]);
  });
  it('ordnet jede Ebene einer Regel zu (ausser leeren Ebenen)', () => {
    expect(r.issues.filter((i) => i.kind === 'unknown_layer')).toEqual([]);
    expect(r.issues.filter((i) => i.kind === 'empty_layer')).toHaveLength(2);
  });
  it('Tageskarte enthält nur den Werdenberger Binnenkanal als Gewässer', () => {
    const names = new Set(r.sections.filter((s) => s.group === 'tageskarte' && s.kind === 'water').map((s) => s.name));
    expect([...names]).toEqual(['Werdenberger Binnenkanal']);
  });
  it('Regeln gelten pro Abschnitt: Binnenkanal in mehreren Ebenen, teilweise gesperrt', () => {
    const wbk = r.sections.filter((s) => s.group === 'aktive' && s.name === 'Werdenberger Binnenkanal');
    expect(new Set(wbk.map((s) => s.layerKind)).size).toBeGreaterThanOrEqual(3);
    expect(wbk.some((s) => s.closed)).toBe(true);
    expect(wbk.some((s) => s.fishingAllowed === true)).toBe(true);
  });
  it('markiert «Nur Kunstköder» als Vorstandsklärung', () => {
    const s = r.sections.filter((x) => x.layerKind === 'artificial_only_unclear');
    expect(s.length).toBe(3 + 3 + 2);
    expect(s.every((x) => x.ruleStatus === 'needs_board' && x.fishingAllowed === null)).toBe(true);
  });
  it('findet die im Anforderungsdokument genannten Datenqualitätsprobleme', () => {
    const kinds = (k: string) => r.issues.filter((i) => i.kind === k);
    const variants = kinds('name_variant_known').map((i) => i.title).join(' ');
    expect(variants).toContain('Lognerbach');
    expect(variants).toContain('Rogghal');
    expect(kinds('clubhouse_name_variant')[0].title).toMatch(/Fischerei Verein Werdenberg|FVW Fischerheim/);
    expect(kinds('rule_text_typo')[0].title).toContain('NNatur');
    expect(kinds('code_format')[0].original).toBe('Code:151');
    expect(kinds('temporal_free_text').some((i) => i.title.includes('Simmi Tal'))).toBe(true);
    expect(kinds('closed_in_rule_layer').every((i) => i.title.includes('Buchser Giessen'))).toBe(true);
  });
  it('ändert ohne Admin-Bestätigung keine Werte', () => {
    const typo = r.sections.find((s) => s.nameOriginal === 'Afagristbächli' && s.ruleTextOriginal?.startsWith('NNatur'))!;
    expect(typo.ruleText).toBe(typo.ruleTextOriginal);
    const logner = r.sections.filter((s) => s.nameOriginal === 'Lognerbach');
    expect(logner.every((s) => s.name === 'Lognerbach')).toBe(true);
  });
  it('übernimmt bestätigte Normalisierungen nachvollziehbar', () => {
    const typo = r.issues.find((i) => i.kind === 'rule_text_typo')!;
    const variant = r.issues.find((i) => i.kind === 'name_variant_known')!;
    const r2 = importMaps(inputs, { [typo.id]: { status: 'bestaetigt' }, [variant.id]: { status: 'bestaetigt' } });
    const s = r2.sections.find((x) => x.id === typo.sectionIds[0])!;
    expect(s.ruleText).toBe(typo.suggestion);
    expect(s.ruleTextOriginal).toContain('NNatur');
    const v = r2.sections.find((x) => x.id === variant.sectionIds[0])!;
    expect(v.name).toBe(variant.suggestion);
    expect(v.nameOriginal).toBe(variant.original);
  });
  it('erzeugt stabile Abschnitts-IDs', () => {
    const again = importMaps(inputs);
    expect(again.sections.map((s) => s.id)).toEqual(r.sections.map((s) => s.id));
    expect(new Set(r.sections.map((s) => s.id)).size).toBe(r.sections.length);
  });
  it('Vereinslokal ist Orientierungspunkt, kein Gewässer', () => {
    const pts = r.sections.filter((s) => s.kind === 'orientation_point');
    expect(pts).toHaveLength(3);
    expect(pts.every((p) => p.isClubhouse && p.fishingAllowed === null)).toBe(true);
  });
  it('Gewässercodes liegen zwischen 151 und 300', () => {
    for (const s of r.stats) for (const c of s.codes) expect(c >= 151 && c <= 300).toBe(true);
  });
});
