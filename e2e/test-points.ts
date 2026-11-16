// Ermittelt Testkoordinaten (gesperrt / ungeklärt / erlaubt / ausserhalb) mit derselben Logik wie die App.
import { readFileSync } from 'node:fs';
import { assessPosition } from '@fvw/shared';
const m = JSON.parse(readFileSync('data/derived/2026/map-aktive.json', 'utf8'));
const secs = m.sections;
function mid(s: any) { const g = s.geometry; const c = g.type === 'LineString' ? g.coordinates : g.type === 'Polygon' ? g.coordinates[0] : [g.coordinates]; return c[Math.floor(c.length / 2)]; }
const out: any = {};
for (const [name, pred] of [['closed', (s: any) => s.layerKind === 'closed' && s.geometryType === 'LineString'], ['unclear', (s: any) => s.layerKind === 'artificial_only_unclear'], ['ok', (s: any) => s.layerKind === 'baits_no_spinner' && s.geometryType === 'LineString']] as const) {
  for (const s of secs.filter(pred)) {
    const p = mid(s);
    const a = assessPosition(p, 10, secs, { toleranceM: 50, date: '2026-11-15' });
    if ((name === 'closed' && a.level === 'closed') || (name === 'unclear' && a.level === 'unclear') || (name === 'ok' && a.level === 'ok')) { out[name] = { lon: p[0], lat: p[1], name: s.name, msg: a.message }; break; }
  }
}
out.outside = { lon: 9.40, lat: 47.25, level: assessPosition([9.40, 47.25], 10, secs, { toleranceM: 50, date: '2026-11-15' }).level };
console.log(JSON.stringify(out, null, 1));
