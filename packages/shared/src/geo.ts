import type { Geometry, Position } from './kml/parse';

export type BBox = [number, number, number, number]; // minLon, minLat, maxLon, maxLat

const EARTH_R = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineMeters(a: Position, b: Position): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Lokale ebene Projektion (Meter) um einen Bezugspunkt – genau genug für das Vereinsgebiet (~20 km). */
function projector(ref: Position) {
  const kx = Math.cos(toRad(ref[1])) * (Math.PI / 180) * EARTH_R;
  const ky = (Math.PI / 180) * EARTH_R;
  return (p: Position): [number, number] => [(p[0] - ref[0]) * kx, (p[1] - ref[1]) * ky];
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function pointInRing(p: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Kürzeste Distanz in Metern vom Punkt zur Geometrie (0 innerhalb einer Fläche). */
export function distanceToGeometryMeters(pt: Position, g: Geometry): number {
  const proj = projector(pt);
  const P: [number, number] = [0, 0];
  const lineDist = (coords: Position[]) => {
    let best = Infinity;
    const c = coords.map(proj);
    for (let i = 1; i < c.length; i++) best = Math.min(best, segDist(P[0], P[1], c[i - 1][0], c[i - 1][1], c[i][0], c[i][1]));
    if (c.length === 1) best = Math.hypot(c[0][0], c[0][1]);
    return best;
  };
  switch (g.type) {
    case 'Point':
      return haversineMeters(pt, g.coordinates);
    case 'LineString':
      return lineDist(g.coordinates);
    case 'Polygon': {
      const rings = g.coordinates.map((r) => r.map(proj));
      const inOuter = pointInRing(P, rings[0]);
      const inHole = rings.slice(1).some((r) => pointInRing(P, r));
      if (inOuter && !inHole) return 0;
      return Math.min(...g.coordinates.map((r) => lineDist(r)));
    }
    case 'GeometryCollection':
      return Math.min(...g.geometries.map((x) => distanceToGeometryMeters(pt, x)));
  }
}

export function geometryBBox(g: Geometry): BBox {
  const b: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  const add = (p: Position) => {
    if (p[0] < b[0]) b[0] = p[0];
    if (p[1] < b[1]) b[1] = p[1];
    if (p[0] > b[2]) b[2] = p[0];
    if (p[1] > b[3]) b[3] = p[1];
  };
  const walk = (x: Geometry) => {
    if (x.type === 'Point') add(x.coordinates);
    else if (x.type === 'LineString') x.coordinates.forEach(add);
    else if (x.type === 'Polygon') x.coordinates.forEach((r) => r.forEach(add));
    else x.geometries.forEach(walk);
  };
  walk(g);
  return b;
}

export function mergeBBox(a: BBox, b: BBox): BBox {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/** Grobe Vorprüfung: liegt der Punkt im (um Meter erweiterten) Rechteck? */
export function bboxNear(pt: Position, b: BBox, meters: number): boolean {
  const dLat = meters / 111_000;
  const dLon = meters / (111_000 * Math.cos(toRad(pt[1])));
  return pt[0] >= b[0] - dLon && pt[0] <= b[2] + dLon && pt[1] >= b[1] - dLat && pt[1] <= b[3] + dLat;
}

/** Douglas-Peucker-Vereinfachung in Metern (für die Darstellung bei kleinem Massstab). */
export function simplifyLine(coords: Position[], toleranceM: number): Position[] {
  if (coords.length <= 2 || toleranceM <= 0) return coords;
  const proj = projector(coords[0]);
  const pts = coords.map(proj);
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  const stack: [number, number][] = [[0, coords.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(pts[i][0], pts[i][1], pts[s][0], pts[s][1], pts[e][0], pts[e][1]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > toleranceM && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}
