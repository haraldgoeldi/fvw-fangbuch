import { closuresFor, simplifyLine, type Closure, type Geometry, type Position, type Section } from '@fvw/shared';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, Platform, Pressable, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import type { Pos } from '../lib/location';
import { useColors } from '../lib/theme';
import { tileSource, type TileSource } from '../lib/tiles';

/**
 * Eigene, vollständig offline-fähige Kartenansicht: Web-Mercator, Kacheln aus MBTiles,
 * Gewässerabschnitte als SVG. Farbe nach Regelstatus (nicht nach Gewässername).
 */
const TILE = 256;
const MIN_Z = 10.5, MAX_Z = 18;
type XY = [number, number];

const lonToX = (lon: number) => (lon + 180) / 360;
const latToY = (lat: number) => { const s = Math.sin((lat * Math.PI) / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
const xToLon = (x: number) => x * 360 - 180;
const yToLat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

interface Prepared { s: Section; levels: XY[][][]; bbox: [number, number, number, number]; point: XY | null; polygon: boolean }

function prepare(sections: Section[]): Prepared[] {
  const tolerances = [25, 6, 0];
  return sections.map((s) => {
    const parts: Position[][] = [];
    let polygon = false, point: XY | null = null;
    const walk = (g: Geometry) => {
      if (g.type === 'Point') point = [lonToX(g.coordinates[0]), latToY(g.coordinates[1])];
      else if (g.type === 'LineString') parts.push(g.coordinates);
      else if (g.type === 'Polygon') { polygon = true; parts.push(...g.coordinates); }
      else g.geometries.forEach(walk);
    };
    walk(s.geometry);
    const levels = tolerances.map((t) => parts.map((p) => simplifyLine(p, t).map((c) => [lonToX(c[0]), latToY(c[1])] as XY)));
    return { s, levels, polygon, point, bbox: [lonToX(s.bbox[0]), latToY(s.bbox[3]), lonToX(s.bbox[2]), latToY(s.bbox[1])] };
  });
}

export interface MapStyle { color: string; width: number; dash?: string; fill?: string }

export function styleFor(s: Section, closed: boolean, c: ReturnType<typeof useColors>, hasCondition: boolean): MapStyle {
  if (s.kind === 'lease_boundary') return { color: c.mapBoundary, width: 2, dash: '10,6' };
  if (s.kind === 'mountain_valley_boundary') return { color: '#6B4FA0', width: 2, dash: '4,5' };
  if (closed) return { color: c.mapClosed, width: 5, fill: 'rgba(192,48,42,0.35)' };
  if (s.fishingAllowed === null) return { color: c.mapUnclear, width: 4.5, dash: '9,5', fill: 'rgba(176,106,0,0.3)' };
  const w = hasCondition ? 5 : 3.5;
  if (s.layerKind === 'baits_all' || s.layerKind === 'voralpsee') return { color: '#0A5BAF', width: w, fill: 'rgba(10,91,175,0.3)' };
  return { color: '#0E8A5F', width: w, fill: 'rgba(14,138,95,0.3)' };
}

export interface WaterMapProps {
  sections: Section[];
  closures: Closure[];
  conditionWaterKeys: Set<string>;
  location: Pos | null;
  selectedId: string | null;
  onSelect: (s: Section | null) => void;
  attribution: string;
  focusRequest?: { lon: number; lat: number; zoom?: number; nonce: number } | null;
}

export const WaterMap = memo(function WaterMap(p: WaterMapProps) {
  const c = useColors();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const prepared = useMemo(() => prepare(p.sections), [p.sections]);
  const extent = useMemo(() => {
    const waters = prepared.filter((x) => x.s.kind === 'water');
    const list = waters.length ? waters : prepared;
    if (!list.length) return null;
    const e: [number, number, number, number] = [1, 1, 0, 0];
    for (const x of list) { e[0] = Math.min(e[0], x.bbox[0]); e[1] = Math.min(e[1], x.bbox[1]); e[2] = Math.max(e[2], x.bbox[2]); e[3] = Math.max(e[3], x.bbox[3]); }
    return e;
  }, [prepared]);
  const [view, setView] = useState<{ cx: number; cy: number; z: number } | null>(null);
  const [gesture, setGesture] = useState<{ dx: number; dy: number; scale: number; fx: number; fy: number } | null>(null);
  const [src, setSrc] = useState<TileSource | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => { tileSource().then(setSrc).catch(() => setSrc(null)); }, []);

  const fit = () => {
    if (!extent || !size.w) return;
    const z = Math.log2(Math.min(size.w / ((extent[2] - extent[0]) * TILE), size.h / ((extent[3] - extent[1]) * TILE))) - 0.1;
    setView({ cx: (extent[0] + extent[2]) / 2, cy: (extent[1] + extent[3]) / 2, z: Math.max(MIN_Z, Math.min(MAX_Z, z)) });
  };
  useEffect(() => { if (!view && size.w && extent) fit(); }, [size.w, extent]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (p.focusRequest) setView((v) => ({ cx: lonToX(p.focusRequest!.lon), cy: latToY(p.focusRequest!.lat), z: p.focusRequest!.zoom ?? Math.max(v?.z ?? 14, 14) })); }, [p.focusRequest?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const viewRef = useRef(view); viewRef.current = view;
  const sizeRef = useRef(size); sizeRef.current = size;
  const onSelectRef = useRef(p.onSelect); onSelectRef.current = p.onSelect;
  const preparedRef = useRef(prepared); preparedRef.current = prepared;

  const toScreen = (v: { cx: number; cy: number; z: number }, x: number, y: number): XY => {
    const sc = TILE * 2 ** v.z;
    return [(x - v.cx) * sc + size.w / 2, (y - v.cy) * sc + size.h / 2];
  };

  function hitTest(px: number, py: number) {
    const v = viewRef.current; const sz = sizeRef.current;
    if (!v) return null;
    const sc = TILE * 2 ** v.z;
    const wx = (px - sz.w / 2) / sc + v.cx, wy = (py - sz.h / 2) / sc + v.cy;
    const tol = 24 / sc;
    let best: { s: Section; d: number } | null = null;
    for (const it of preparedRef.current) {
      if (wx < it.bbox[0] - tol || wx > it.bbox[2] + tol || wy < it.bbox[1] - tol || wy > it.bbox[3] + tol) continue;
      let d = Infinity;
      if (it.point) d = Math.hypot(wx - it.point[0], wy - it.point[1]);
      for (const part of it.levels[2]) {
        for (let i = 1; i < part.length; i++) d = Math.min(d, segDist(wx, wy, part[i - 1], part[i]));
        if (it.polygon && pointInRing(wx, wy, part)) d = 0;
      }
      const prio = it.s.kind === 'water' ? 0 : tol * 0.5;
      if (d <= tol && (!best || d + prio < best.d)) best = { s: it.s, d: d + prio };
    }
    return best?.s ?? null;
  }

  const g = useRef({ start: 0, x0: 0, y0: 0, dist0: 0, mx0: 0, my0: 0, pinch: false, moved: false, lastTap: 0 });
  const containerRef = useRef<any>(null);
  const origin = useRef({ x: 0, y: 0 });
  const local = (pageX: number, pageY: number): XY => [pageX - origin.current.x, pageY - origin.current.y];
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e: GestureResponderEvent) => {
      containerRef.current?.measureInWindow((x: number, y: number) => { origin.current = { x, y }; });
      const t = e.nativeEvent.touches;
      g.current = { ...g.current, start: Date.now(), x0: e.nativeEvent.pageX, y0: e.nativeEvent.pageY, pinch: t.length >= 2, moved: false, dist0: 0 };
      if (t.length >= 2) startPinch(e);
    },
    onPanResponderMove: (e) => {
      const t = e.nativeEvent.touches;
      if (t.length >= 2) {
        if (!g.current.pinch) startPinch(e);
        const dist = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
        const [mx, my] = local((t[0].pageX + t[1].pageX) / 2, (t[0].pageY + t[1].pageY) / 2);
        g.current.moved = true;
        setGesture({ dx: mx - g.current.mx0, dy: my - g.current.my0, scale: dist / (g.current.dist0 || dist), fx: g.current.mx0, fy: g.current.my0 });
      } else if (!g.current.pinch) {
        const dx = e.nativeEvent.pageX - g.current.x0, dy = e.nativeEvent.pageY - g.current.y0;
        if (Math.abs(dx) + Math.abs(dy) > 6) g.current.moved = true;
        if (g.current.moved) setGesture({ dx, dy, scale: 1, fx: 0, fy: 0 });
      }
    },
    onPanResponderRelease: (e) => {
      commit();
      if (!g.current.moved && !g.current.pinch && Date.now() - g.current.start < 400) {
        const now = Date.now();
        const [lx, ly] = local(e.nativeEvent.pageX, e.nativeEvent.pageY);
        if (now - g.current.lastTap < 300) zoomAt(lx, ly, 1);
        else onSelectRef.current(hitTest(lx, ly));
        g.current.lastTap = now;
      }
    },
    onPanResponderTerminate: () => commit(),
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  function startPinch(e: GestureResponderEvent) {
    const t = e.nativeEvent.touches;
    g.current.pinch = true;
    g.current.dist0 = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
    const [mx0, my0] = local((t[0].pageX + t[1].pageX) / 2, (t[0].pageY + t[1].pageY) / 2);
    g.current.mx0 = mx0;
    g.current.my0 = my0;
  }

  const gestureRef = useRef(gesture); gestureRef.current = gesture;
  function commit() {
    const ge = gestureRef.current; const v = viewRef.current; const sz = sizeRef.current;
    setGesture(null);
    if (!ge || !v) return;
    const sc = TILE * 2 ** v.z;
    const nz = Math.max(MIN_Z, Math.min(MAX_Z, v.z + Math.log2(ge.scale)));
    const realScale = 2 ** (nz - v.z);
    // Punkt unter dem Fokus bleibt fest: world(f) = c + (f - s/2)/sc
    const fx = ge.scale === 1 ? sz.w / 2 : ge.fx, fy = ge.scale === 1 ? sz.h / 2 : ge.fy;
    const wfx = v.cx + (fx - sz.w / 2) / sc, wfy = v.cy + (fy - sz.h / 2) / sc;
    const nsc = sc * realScale;
    const nfx = fx + ge.dx, nfy = fy + ge.dy;
    setView({ cx: wfx - (nfx - sz.w / 2) / nsc, cy: wfy - (nfy - sz.h / 2) / nsc, z: nz });
  }
  function zoomAt(px: number, py: number, dz: number) {
    const v = viewRef.current; const sz = sizeRef.current;
    if (!v) return;
    const sc = TILE * 2 ** v.z;
    const wx = v.cx + (px - sz.w / 2) / sc, wy = v.cy + (py - sz.h / 2) / sc;
    const nz = Math.max(MIN_Z, Math.min(MAX_Z, v.z + dz));
    const nsc = TILE * 2 ** nz;
    setView({ cx: wx - (px - sz.w / 2) / nsc, cy: wy - (py - sz.h / 2) / nsc, z: nz });
  }

  const onLayout = (e: LayoutChangeEvent) => {
    setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
    containerRef.current?.measureInWindow((x: number, y: number) => { origin.current = { x, y }; });
  };

  // ---------- Kacheln
  const tiles = useMemo(() => {
    if (!view || !size.w || !src) return [];
    const tz = Math.max(src.minZoom, Math.min(src.maxZoom, Math.round(view.z)));
    const scale = 2 ** (view.z - tz);
    const n = 2 ** tz;
    const tsz = TILE * scale;
    const cxp = view.cx * n * TILE * scale, cyp = view.cy * n * TILE * scale;
    const x0 = Math.floor((cxp - size.w / 2) / tsz), x1 = Math.floor((cxp + size.w / 2) / tsz);
    const y0 = Math.floor((cyp - size.h / 2) / tsz), y1 = Math.floor((cyp + size.h / 2) / tsz);
    const out: { key: string; z: number; x: number; y: number; left: number; top: number; size: number }[] = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      out.push({ key: `${tz}/${x}/${y}`, z: tz, x, y, left: x * tsz - cxp + size.w / 2, top: y * tsz - cyp + size.h / 2, size: tsz + 0.5 });
    }
    return out;
  }, [view, size, src]);

  // ---------- Vektoren
  const paths = useMemo(() => {
    if (!view || !size.w) return [];
    const level = view.z < 12.5 ? 0 : view.z < 14.5 ? 1 : 2;
    const sc = TILE * 2 ** view.z;
    const minX = view.cx - size.w / 2 / sc, maxX = view.cx + size.w / 2 / sc, minY = view.cy - size.h / 2 / sc, maxY = view.cy + size.h / 2 / sc;
    const out: { id: string; d: string; st: MapStyle; polygon: boolean; point: XY | null; selected: boolean; club: boolean }[] = [];
    const ordered = [...prepared].sort((a, b) => rank(a.s, p.closures, today) - rank(b.s, p.closures, today));
    for (const it of ordered) {
      if (it.bbox[2] < minX || it.bbox[0] > maxX || it.bbox[3] < minY || it.bbox[1] > maxY) continue;
      const closed = it.s.closed || closuresFor(it.s, p.closures, today).length > 0;
      const st = styleFor(it.s, closed, c, p.conditionWaterKeys.has(it.s.waterKey));
      if (it.point) { const [x, y] = toScreen(view, it.point[0], it.point[1]); out.push({ id: it.s.id, d: '', st, polygon: false, point: [x, y], selected: it.s.id === p.selectedId, club: it.s.isClubhouse }); continue; }
      let d = '';
      for (const part of it.levels[level]) {
        part.forEach((pt, i) => { const [x, y] = toScreen(view, pt[0], pt[1]); d += `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; });
        if (it.polygon) d += 'Z';
      }
      out.push({ id: it.s.id, d, st, polygon: it.polygon, point: null, selected: it.s.id === p.selectedId, club: false });
    }
    return out;
  }, [prepared, view, size, p.selectedId, p.closures, p.conditionWaterKeys, c]); // eslint-disable-line react-hooks/exhaustive-deps

  const loc = view && p.location ? toScreen(view, lonToX(p.location.lon), latToY(p.location.lat)) : null;
  const accPx = view && p.location?.accuracyM ? (p.location.accuracyM / (156543.03 * Math.cos((p.location.lat * Math.PI) / 180))) * 2 ** view.z : 0;
  // Skalierung um den Fokuspunkt f (RN skaliert um die Mitte c): t = d + (f − c)(1 − s)
  const transform = gesture ? [
    { translateX: gesture.dx + (gesture.scale !== 1 ? (gesture.fx - size.w / 2) * (1 - gesture.scale) : 0) },
    { translateY: gesture.dy + (gesture.scale !== 1 ? (gesture.fy - size.h / 2) * (1 - gesture.scale) : 0) },
    { scale: gesture.scale },
  ] : [];

  return (
    <View ref={containerRef} style={{ flex: 1, overflow: 'hidden', backgroundColor: '#E8EDE6' }} onLayout={onLayout} testID="water-map" {...pan.panHandlers}>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: size.w, height: size.h, transform }}>
        {src ? tiles.map((t) => <Tile key={t.key} src={src} z={t.z} x={t.x} y={t.y} left={t.left} top={t.top} size={t.size} />) : null}
        <Svg width={size.w} height={size.h} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
          {paths.map((pa) => pa.point ? (
            <G key={pa.id}>
              <Circle cx={pa.point[0]} cy={pa.point[1]} r={pa.selected ? 12 : 9} fill="#E0A100" stroke="#10212A" strokeWidth={2} />
            </G>
          ) : (
            <G key={pa.id}>
              {pa.selected ? <Path d={pa.d} stroke="#FFFFFF" strokeWidth={pa.st.width + 6} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
              <Path d={pa.d} stroke={pa.st.color} strokeWidth={pa.selected ? pa.st.width + 2 : pa.st.width} strokeDasharray={pa.st.dash} fill={pa.polygon ? pa.st.fill : 'none'} strokeLinecap="round" strokeLinejoin="round" />
            </G>
          ))}
          {loc ? (
            <G>
              {accPx > 8 ? <Circle cx={loc[0]} cy={loc[1]} r={accPx} fill="rgba(30,120,255,0.15)" stroke="rgba(30,120,255,0.5)" strokeWidth={1} /> : null}
              <Circle cx={loc[0]} cy={loc[1]} r={10} fill="#1E78FF" stroke="#FFFFFF" strokeWidth={3} />
            </G>
          ) : null}
        </Svg>
      </View>
      <View style={{ position: 'absolute', right: 10, top: 10, gap: 8 }}>
        <MapBtn label="+" a11y="Hineinzoomen" onPress={() => zoomAt(size.w / 2, size.h / 2, 1)} />
        <MapBtn label="−" a11y="Herauszoomen" onPress={() => zoomAt(size.w / 2, size.h / 2, -1)} />
        <MapBtn label="⤢" a11y="Ganzes Gebiet anzeigen" onPress={fit} />
        {p.location ? <MapBtn label="◎" a11y="Auf meinen Standort zentrieren" onPress={() => setView((v) => v && ({ cx: lonToX(p.location!.lon), cy: latToY(p.location!.lat), z: Math.max(v.z, 15) }))} /> : null}
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', right: 6, bottom: 4, backgroundColor: 'rgba(255,255,255,0.85)', paddingHorizontal: 6, borderRadius: 4 }}>
        <Text style={{ fontSize: 11, color: '#222' }}>{p.attribution}{src ? ` · ${src.label}` : ''}</Text>
      </View>
    </View>
  );
});

function rank(s: Section, closures: Closure[], date: string) {
  if (s.kind === 'orientation_point') return 5;
  if (s.kind !== 'water') return 0;
  if (s.closed || closuresFor(s, closures, date).length) return 3;
  if (s.fishingAllowed === null) return 2;
  return 1;
}

function segDist(px: number, py: number, a: XY, b: XY) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}
function pointInRing(px: number, py: number, ring: XY[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const Tile = memo(function Tile({ src, z, x, y, left, top, size }: { src: TileSource; z: number; x: number; y: number; left: number; top: number; size: number }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => { let alive = true; src.get(z, x, y).then((u) => alive && setUri(u)); return () => { alive = false; }; }, [src, z, x, y]);
  if (!uri) return null;
  return <Image source={{ uri }} style={{ position: 'absolute', left, top, width: size, height: size }} fadeDuration={0} {...(Platform.OS === 'web' ? { draggable: false } as any : {})} />;
});

function MapBtn({ label, a11y, onPress }: { label: string; a11y: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y}
      style={{ width: 52, height: 52, borderRadius: 12, backgroundColor: c.surface, borderColor: c.line, borderWidth: 2, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 26, fontWeight: '800', color: c.ink }}>{label}</Text>
    </Pressable>
  );
}

export { xToLon, yToLat };
