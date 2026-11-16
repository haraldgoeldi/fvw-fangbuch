import { describe, expect, it } from 'vitest';
import {
  assessPosition, catchesToCsv, distanceToGeometryMeters, formatDateCH, formatTimeCH, parseDescription, permissionsFor,
  tourDurationSec, validateCatch, validateLength, type Section, DEFAULT_FISH_SPECIES, closuresFor, suggestWaters,
} from '../src';

describe('Beschreibung', () => {
  it('liest Code, Regeltext und Bilder', () => {
    const d = parseDescription('<img src="https://x/y.jpg" height="200" /><br><br>Gewässercode: 152<br>Natur- & Kunstköder, Löffel, Wobbler & Spinner erlaubt.');
    expect(d.code).toBe(152);
    expect(d.codeStandard).toBe(true);
    expect(d.imageUrls).toEqual(['https://x/y.jpg']);
    expect(d.ruleText).toBe('Natur- & Kunstköder, Löffel, Wobbler & Spinner erlaubt.');
  });
  it('erkennt abweichendes Code-Format und Freitext-Sperre', () => {
    expect(parseDescription('Code:151<br>Nur Kunstköder').codeStandard).toBe(false);
    const s = parseDescription('Gewässercode: 252 ist bis 30.04.gesperrt<br>Natur- & Kunstköder');
    expect(s.code).toBe(252);
    expect(s.temporalText).toBe('ist bis 30.04.gesperrt');
    expect(s.mentionsClosed).toBe(true);
  });
});

describe('Geometrie und Lagehinweis', () => {
  const line: Section = {
    id: 'a', group: 'aktive', placemarkIndex: 0, layerIndex: 0, layerName: 'x', layerKind: 'baits_all', name: 'Testbach', nameOriginal: 'Testbach',
    waterKey: 'testbach', code: 181, codeOriginal: null, ruleText: null, ruleTextOriginal: null, ruleLabel: 'Alle Köder erlaubt', ruleMeaning: '',
    ruleStatus: 'from_source', fishingAllowed: true, closed: false, conflict: null, temporalText: null, kind: 'water', isClubhouse: false,
    riverRules: false, decisionRefs: [], photoUrls: [], color: null, geometryType: 'LineString',
    geometry: { type: 'LineString', coordinates: [[9.45, 47.2], [9.46, 47.2]] }, bbox: [9.45, 47.2, 9.46, 47.2],
  };
  const closed: Section = { ...line, id: 'b', name: 'Sperrbach', waterKey: 'sperrbach', layerKind: 'closed', closed: true, fishingAllowed: false,
    geometry: { type: 'LineString', coordinates: [[9.45, 47.21], [9.46, 47.21]] }, bbox: [9.45, 47.21, 9.46, 47.21] };
  it('misst Distanz zur Linie', () => {
    const d = distanceToGeometryMeters([9.455, 47.2005], line.geometry);
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThan(60);
  });
  it('warnt in gesperrten Bereichen', () => {
    const a = assessPosition([9.455, 47.2101], 10, [line, closed], { toleranceM: 50, date: '2026-06-01' });
    expect(a.level).toBe('closed');
    expect(a.disclaimer).toMatch(/kein verbindlicher Rechtsnachweis/);
  });
  it('meldet erlaubtes Gewässer bzw. ausserhalb', () => {
    expect(assessPosition([9.455, 47.2001], 10, [line, closed], { toleranceM: 50, date: '2026-06-01' }).level).toBe('ok');
    expect(assessPosition([9.455, 47.205], 10, [line, closed], { toleranceM: 50, date: '2026-06-01' }).level).toBe('outside');
  });
  it('berücksichtigt strukturierte Sperrzeiten nur im Zeitraum', () => {
    const c = [{ id: 'c', waterKey: 'testbach', sectionIds: [], groups: null, from: '2026-01-01', to: '2026-04-30', reason: 'Test', status: 'active' as const }];
    expect(closuresFor(line, c, '2026-03-01')).toHaveLength(1);
    expect(closuresFor(line, c, '2026-05-01')).toHaveLength(0);
    expect(assessPosition([9.455, 47.2001], 10, [line], { toleranceM: 50, date: '2026-03-01', closures: c }).level).toBe('closed');
  });
  it('schlägt nächstgelegene Gewässer vor', () => {
    const s = suggestWaters([9.455, 47.2003], [line, closed]);
    expect(s[0].name).toBe('Testbach');
  });
});

describe('Fang, Tour, CSV', () => {
  it('validiert Länge ohne Mindestmass', () => {
    expect(validateLength(1)).toBeNull();
    expect(validateLength(0)).not.toBeNull();
    expect(validateLength(32.5)).not.toBeNull();
    expect(validateLength('abc')).not.toBeNull();
  });
  it('Fang nur während laufender Tour', () => {
    const c = { species: 'Äsche', lengthCm: 30, disposition: 'zurueckgesetzt' as const, caughtAt: new Date().toISOString() };
    expect(validateCatch(c, { status: 'running', startedAt: '', endedAt: null }, DEFAULT_FISH_SPECIES)).toEqual([]);
    expect(validateCatch(c, { status: 'closed', startedAt: '', endedAt: '' }, DEFAULT_FISH_SPECIES)[0].field).toBe('tourId');
    expect(validateCatch(c, null, DEFAULT_FISH_SPECIES)[0].field).toBe('tourId');
  });
  it('rechnet Pausen aus der Dauer', () => {
    const t = { startedAt: '2026-06-01T08:00:00Z', endedAt: '2026-06-01T10:00:00Z', pauses: [{ start: '2026-06-01T08:30:00Z', end: '2026-06-01T09:00:00Z' }] };
    expect(tourDurationSec(t)).toBe(90 * 60);
  });
  it('erzeugt CSV mit Pflichtspalten, Umlauten und Schweizer Zeit', () => {
    const csv = catchesToCsv([
      { caughtAt: '2026-07-01T05:30:00Z', memberName: 'Müller, Jörg', waterName: 'Werdenberger Binnenkanal', species: 'Äsche', lengthCm: 34, disposition: 'zurueckgesetzt' },
      { caughtAt: '2026-01-10T12:00:00Z', memberName: '=HYPERLINK("x")', waterName: 'Voralpsee', species: 'Hecht', lengthCm: 70, disposition: 'entnommen' },
    ]);
    expect(csv.startsWith('﻿Datum;Uhrzeit;Mitglied;Gewässer;Art;Länge;Entnommen\r\n')).toBe(true);
    expect(csv).toContain('10.01.2026;13:00;');
    expect(csv).toContain('01.07.2026;07:30;Müller, Jörg;Werdenberger Binnenkanal;Äsche;34;nein');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(formatDateCH('2026-10-25T00:30:00Z')).toBe('25.10.2026');
    expect(formatTimeCH('2026-10-25T00:30:00Z')).toBe('02:30');
    expect(formatTimeCH('2026-10-25T01:30:00Z')).toBe('02:30');
  });
});

describe('Berechtigungen', () => {
  it('Aufseher ohne vereinsweite Fangliste', () => {
    expect(permissionsFor(['warden'])).not.toContain('catches.read_all');
    expect(permissionsFor(['warden'], ['catches.read_all'])).toContain('catches.read_all');
    expect(permissionsFor(['member'])).not.toContain('controls.write');
    expect(permissionsFor(['admin'])).toContain('catches.read_all');
    expect(permissionsFor(['guest'])).not.toContain('news.read_members');
  });
});
