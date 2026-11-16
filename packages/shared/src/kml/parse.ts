import { XMLParser } from 'fast-xml-parser';

export type Position = [number, number];
export type Geometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'GeometryCollection'; geometries: Geometry[] };

export interface KmlPlacemark {
  /** Laufnummer im Dokument (0-basiert, Reihenfolge wie in der Datei). */
  index: number;
  layerIndex: number;
  layerName: string;
  /** Pfad bei verschachtelten Ordnern («Ebene / Unterordner»). */
  folderPath: string;
  name: string;
  description: string;
  styleUrl: string | null;
  extendedData: Record<string, string>;
  geometry: Geometry | null;
}

export interface KmlLayer {
  index: number;
  name: string;
  placemarkCount: number;
}

export interface KmlNetworkLink {
  name: string;
  href: string;
}

export interface KmlDocument {
  name: string;
  layers: KmlLayer[];
  placemarks: KmlPlacemark[];
  networkLinks: KmlNetworkLink[];
  /** true, wenn das Dokument nur Netzwerklinks und keine Kartenobjekte enthält. */
  networkLinkOnly: boolean;
}

const ARRAY_TAGS = new Set([
  'Document', 'Folder', 'Placemark', 'Data', 'SimpleData', 'NetworkLink', 'Point', 'LineString', 'Polygon',
  'LinearRing', 'innerBoundaryIs', 'MultiGeometry', 'Style', 'StyleMap', 'Pair',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
  htmlEntities: false,
  isArray: (name) => ARRAY_TAGS.has(name),
});

type Node = Record<string, any>;

function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object' && '#text' in (v as Node)) return String((v as Node)['#text']);
  return '';
}

function parseCoords(s: string): Position[] {
  const out: Position[] = [];
  for (const tok of s.trim().split(/\s+/)) {
    if (!tok) continue;
    const parts = tok.split(',');
    const lon = Number(parts[0]);
    const lat = Number(parts[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) out.push([lon, lat]);
  }
  return out;
}

function geomsOf(node: Node): Geometry[] {
  const geoms: Geometry[] = [];
  for (const p of node.Point ?? []) {
    const c = parseCoords(text(p.coordinates));
    if (c.length) geoms.push({ type: 'Point', coordinates: c[0] });
  }
  for (const l of node.LineString ?? []) {
    const c = parseCoords(text(l.coordinates));
    if (c.length >= 2) geoms.push({ type: 'LineString', coordinates: c });
  }
  for (const pg of node.Polygon ?? []) {
    const outer = pg.outerBoundaryIs?.LinearRing?.[0];
    if (!outer) continue;
    const rings: Position[][] = [parseCoords(text(outer.coordinates))];
    for (const ib of pg.innerBoundaryIs ?? []) {
      const r = ib.LinearRing?.[0];
      if (r) rings.push(parseCoords(text(r.coordinates)));
    }
    if (rings[0].length >= 3) geoms.push({ type: 'Polygon', coordinates: rings });
  }
  for (const mg of node.MultiGeometry ?? []) geoms.push(...geomsOf(mg));
  return geoms;
}

function placemarkGeometry(pm: Node): Geometry | null {
  const g = geomsOf(pm);
  if (g.length === 0) return null;
  if (g.length === 1) return g[0];
  return { type: 'GeometryCollection', geometries: g };
}

/** KML-Text einlesen. Wirft bei ungültigem XML. */
export function parseKml(xml: string): KmlDocument {
  const root = parser.parse(xml) as Node;
  const kml = root.kml;
  if (!kml) throw new Error('Kein <kml>-Element gefunden');
  const doc: Node = kml.Document?.[0] ?? kml;
  const layers: KmlLayer[] = [];
  const placemarks: KmlPlacemark[] = [];
  const networkLinks: KmlNetworkLink[] = [];

  const collectLinks = (n: Node) => {
    for (const nl of n.NetworkLink ?? []) {
      networkLinks.push({ name: text(nl.name).trim(), href: text(nl.Link?.href ?? nl.Url?.href).trim() });
    }
  };
  collectLinks(doc);

  const visit = (folder: Node, layerIndex: number, layerName: string, path: string) => {
    collectLinks(folder);
    for (const pm of folder.Placemark ?? []) {
      const ext: Record<string, string> = {};
      for (const d of pm.ExtendedData?.Data ?? []) ext[d['@_name']] = text(d.value).trim();
      placemarks.push({
        index: placemarks.length,
        layerIndex,
        layerName,
        folderPath: path,
        name: text(pm.name),
        description: text(pm.description),
        styleUrl: pm.styleUrl ? text(pm.styleUrl).trim() : null,
        extendedData: ext,
        geometry: placemarkGeometry(pm),
      });
    }
    for (const sub of folder.Folder ?? []) {
      const n = text(sub.name);
      visit(sub, layerIndex, layerName, `${path} / ${n}`);
    }
  };

  // Placemarks direkt im Dokument (ohne Ebene)
  const topLevel = doc.Placemark ?? [];
  if (topLevel.length) {
    layers.push({ index: layers.length, name: '', placemarkCount: 0 });
    visit({ Placemark: topLevel }, 0, '', '');
  }
  for (const f of doc.Folder ?? []) {
    const name = text(f.name);
    const idx = layers.length;
    const before = placemarks.length;
    visit(f, idx, name, name);
    layers.push({ index: idx, name, placemarkCount: placemarks.length - before });
  }
  if (topLevel.length) layers[0].placemarkCount = placemarks.filter((p) => p.layerIndex === 0 && p.layerName === '').length;

  return {
    name: text(doc.name).trim(),
    layers,
    placemarks,
    networkLinks,
    networkLinkOnly: placemarks.length === 0 && networkLinks.length > 0,
  };
}

/** Extrahiert die My-Maps-ID aus einem Netzwerklink. */
export function myMapsIdFromHref(href: string): string | null {
  const m = /[?&]mid=([A-Za-z0-9_-]+)/.exec(href);
  return m ? m[1] : null;
}

/** Farbe aus My-Maps-Stil-ID (z. B. «#line-0F9D58-3000» → «#0F9D58»). */
export function colorFromStyleUrl(styleUrl: string | null): string | null {
  if (!styleUrl) return null;
  const m = /-(?:([0-9A-Fa-f]{6}))-/.exec(styleUrl);
  return m ? `#${m[1].toUpperCase()}` : null;
}
