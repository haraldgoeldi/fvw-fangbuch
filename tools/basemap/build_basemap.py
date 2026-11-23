#!/usr/bin/env python3
"""
Offline-Basiskarte (MBTiles) aus dem swisstopo-Downloadservice erzeugen.

Warum Downloadservice und nicht WMTS?
  Die "Allgemeinen Nutzungsbedingungen und Betriebsbestimmungen der BGDI" (geo.admin.ch,
  publiziert 9.12.2021) verlangen: "Für den Bezug der Datensätze ausserhalb des Kontextes der
  Webdienste (Nutzung in offline Systemen, Datenbanken usw.) ist der Downloadservice zu nutzen."
  Deshalb werden hier die Cloud-optimierten GeoTIFFs der Landeskarte 1:25'000 vom STAC-
  Downloadservice data.geo.admin.ch verwendet und lokal in Web-Mercator-Kacheln umgerechnet.
  Quellenangabe gemäss Ziff. 3.1: "© Data: swisstopo".

Aufruf (Python >= 3.10, Pakete: rasterio, numpy, pillow):
  python build_basemap.py --geojson ../../data/derived/2026/waters-all.geojson \
         --out ../../data/basemap/lk25-werdenberg.mbtiles --cache ./cache

Die Ausdehnung wird aus den Gewässergeometrien abgeleitet (+ Rand). Zoom 11-15 deckt das
ganze Gebiet ab, Zoom 16 nur Kacheln im Umkreis --detail-buffer-m um Gewässer (Datenmenge).
"""
import argparse, hashlib, io, json, math, os, sqlite3, sys, time, urllib.request
from datetime import datetime, timezone

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject, transform_bounds
from rasterio.transform import Affine, from_bounds
from PIL import Image

STAC = "https://data.geo.admin.ch/api/stac/v0.9/collections/{coll}/items?bbox={bbox}&limit=100"
COLLECTION = "ch.swisstopo.pixelkarte-farbe-pk25.noscale"
R = 6378137.0
ORIGIN = math.pi * R


def lonlat_to_merc(lon, lat):
    x = math.radians(lon) * R
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R
    return x, y


def tile_bounds(z, x, y):
    size = 2 * ORIGIN / (2 ** z)
    minx = -ORIGIN + x * size
    maxy = ORIGIN - y * size
    return minx, maxy - size, minx + size, maxy


def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    xt = int((lon + 180) / 360 * n)
    lat_r = math.radians(lat)
    yt = int((1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * n)
    return xt, yt



_RGB_CACHE = {}


def downsampled_rgb(src, lut, factor):
    """Quelle (Palettenbild, 1.25 m) als RGB, um `factor` flächig gemittelt (Box-Filter)."""
    key = (src.name, factor)
    if key in _RGB_CACHE:
        return _RGB_CACHE[key]
    if (src.name, 1) not in _RGB_CACHE:
        _RGB_CACHE[(src.name, 1)] = lut[src.read(1)].transpose(2, 0, 1)
    full = _RGB_CACHE[(src.name, 1)]
    if factor == 1:
        return full
    h, w = (full.shape[1] // factor) * factor, (full.shape[2] // factor) * factor
    out = np.empty((3, h // factor, w // factor), dtype=np.uint8)
    for b in range(3):
        out[b] = full[b, :h, :w].reshape(h // factor, factor, w // factor, factor).mean(axis=(1, 3), dtype=np.float32).round().astype(np.uint8)
    _RGB_CACHE[key] = out
    return out

def http_json(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_geometries(path):
    gj = json.load(open(path, encoding="utf-8"))
    pts = []
    for f in gj["features"]:
        g = f["geometry"]
        if not g:
            continue
        def walk(c):
            if isinstance(c[0], (int, float)):
                pts.append((c[0], c[1]))
            else:
                for cc in c:
                    walk(cc)
        walk(g["coordinates"])
    return pts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--geojson", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--cache", default="./cache")
    ap.add_argument("--year", default=None, help="Ausgabejahr der Landeskarte (Standard: neuestes)")
    ap.add_argument("--margin-deg", type=float, default=0.01)
    ap.add_argument("--minzoom", type=int, default=11)
    ap.add_argument("--maxzoom", type=int, default=16)
    ap.add_argument("--full-upto", type=int, default=15, help="bis zu diesem Zoom die ganze Fläche")
    ap.add_argument("--detail-buffer-m", type=float, default=600)
    ap.add_argument("--quality", type=int, default=72)
    a = ap.parse_args()

    pts = load_geometries(a.geojson)
    lons = [p[0] for p in pts]; lats = [p[1] for p in pts]
    bbox = (min(lons) - a.margin_deg, min(lats) - a.margin_deg, max(lons) + a.margin_deg, max(lats) + a.margin_deg)
    print("Gebiet (WGS84):", bbox, "aus", len(pts), "Stützpunkten")

    items = http_json(STAC.format(coll=COLLECTION, bbox=",".join(f"{v:.5f}" for v in bbox)))["features"]
    by_sheet = {}
    for it in items:
        year = it["id"].split("_")[1]
        sheet = it["id"].split("_")[2]
        if a.year and year != a.year:
            continue
        if sheet not in by_sheet or year > by_sheet[sheet][0]:
            by_sheet[sheet] = (year, it)
    os.makedirs(a.cache, exist_ok=True)
    sources = []
    for sheet, (year, it) in sorted(by_sheet.items()):
        asset = next(v for k, v in it["assets"].items() if "_komb_" in k)
        fn = os.path.join(a.cache, asset["href"].split("/")[-1])
        if not os.path.exists(fn):
            print("Lade", asset["href"])
            urllib.request.urlretrieve(asset["href"], fn)
        sources.append({"sheet": sheet, "year": year, "item": it["id"], "href": asset["href"], "file": fn, "sha256": sha256(fn)})
    print("Quellen:", [(s["sheet"], s["year"]) for s in sources])

    # Gewässer-Stützpunkte in Mercator für den Detail-Puffer
    merc_pts = np.array([lonlat_to_merc(*p) for p in pts])

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    if os.path.exists(a.out):
        os.remove(a.out)
    db = sqlite3.connect(a.out)
    db.executescript("""
      CREATE TABLE metadata (name TEXT, value TEXT);
      CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
      CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
    """)

    srcs = [rasterio.open(s["file"]) for s in sources]
    cmap = srcs[0].colormap(1)
    lut = np.zeros((256, 3), dtype=np.uint8)
    for i, rgba in cmap.items():
        lut[i] = rgba[:3]

    total = 0; total_bytes = 0; per_zoom = {}
    for z in range(a.minzoom, a.maxzoom + 1):
        x0, y0 = lonlat_to_tile(bbox[0], bbox[3], z)
        x1, y1 = lonlat_to_tile(bbox[2], bbox[1], z)
        # Ganzes Zoom-Gebiet als ein Raster rendern, dann zerschneiden
        mb = (tile_bounds(z, x0, y0)[0], tile_bounds(z, x1, y1)[1], tile_bounds(z, x1, y1)[2], tile_bounds(z, x0, y0)[3])
        w = (x1 - x0 + 1) * 256; h = (y1 - y0 + 1) * 256
        dst_t = from_bounds(*mb, w, h)
        res = (mb[2] - mb[0]) / w
        rgb = np.full((3, h, w), 0, dtype=np.uint8); valid = np.zeros((h, w), dtype=bool)
        for src in srcs:
            # passende Übersichtsstufe wählen (Quelle 1.25 m, Mercator-Pixel am 47. Breitengrad ~ res*cos(lat))
            ground = res * math.cos(math.radians((bbox[1] + bbox[3]) / 2))
            factor = max(1, int(ground / 1.25))
            # Erst in Farbe umrechnen, dann flächig mitteln (statt jedes n-te Palettenpixel zu nehmen):
            # sonst verschwinden feine Linien und Schrift wird unleserlich.
            s_rgb = downsampled_rgb(src, lut, factor)
            oh, ow = s_rgb.shape[1], s_rgb.shape[2]
            s_t = src.transform * Affine.scale(factor, factor)
            for b in range(3):
                band = np.zeros((h, w), dtype=np.uint8)
                reproject(s_rgb[b], band, src_transform=s_t, src_crs=src.crs, dst_transform=dst_t, dst_crs="EPSG:3857",
                          resampling=Resampling.lanczos, src_nodata=None, dst_nodata=0)
                if b == 0:
                    m = np.zeros((h, w), dtype=np.uint8)
                    reproject(np.ones((oh, ow), dtype=np.uint8), m, src_transform=s_t, src_crs=src.crs, dst_transform=dst_t,
                              dst_crs="EPSG:3857", resampling=Resampling.nearest, src_nodata=None, dst_nodata=0)
                    newmask = (m == 1) & ~valid
                rgb[b][newmask] = band[newmask]
            valid |= newmask
        n = 0
        for tx in range(x0, x1 + 1):
            for ty in range(y0, y1 + 1):
                bx, by = (tx - x0) * 256, (ty - y0) * 256
                vmask = valid[by:by + 256, bx:bx + 256]
                if not vmask.any():
                    continue
                if z > a.full_upto:
                    tb = tile_bounds(z, tx, ty)
                    buf = a.detail_buffer_m / math.cos(math.radians(47.2))
                    inside = ((merc_pts[:, 0] > tb[0] - buf) & (merc_pts[:, 0] < tb[2] + buf) &
                              (merc_pts[:, 1] > tb[1] - buf) & (merc_pts[:, 1] < tb[3] + buf))
                    if not inside.any():
                        continue
                tile = rgb[:, by:by + 256, bx:bx + 256].transpose(1, 2, 0).copy()
                tile[~vmask] = (238, 241, 236)
                bio = io.BytesIO()
                Image.fromarray(tile, "RGB").save(bio, "JPEG", quality=a.quality, optimize=True, progressive=False)
                data = bio.getvalue()
                tms_row = (2 ** z - 1) - ty
                db.execute("INSERT INTO tiles VALUES (?,?,?,?)", (z, tx, tms_row, data))
                n += 1; total_bytes += len(data)
        per_zoom[z] = n; total += n
        print(f"Zoom {z}: {n} Kacheln")
    meta = {
        "name": "Landeskarte 1:25'000 – Region Werdenberg (offline)",
        "format": "jpg", "type": "baselayer", "version": "1",
        "description": "Offline-Kartenausschnitt für die Fangbuch-App des Fischereivereins Werdenberg",
        "attribution": "© Data: swisstopo",
        "bounds": ",".join(f"{v:.6f}" for v in bbox),
        "center": f"{(bbox[0]+bbox[2])/2:.6f},{(bbox[1]+bbox[3])/2:.6f},13",
        "minzoom": str(a.minzoom), "maxzoom": str(a.maxzoom),
        "fvw_full_upto_zoom": str(a.full_upto), "fvw_detail_buffer_m": str(a.detail_buffer_m),
        "fvw_created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fvw_sources": json.dumps([{k: v for k, v in s.items() if k != "file"} for s in sources]),
        "fvw_license_note": "BGDI-Nutzungsbedingungen (geo.admin.ch, 9.12.2021): kostenlos, Quellenangabe Pflicht, Offline-Bezug über Downloadservice. Datensatzbedingungen: swisstopo OGD (https://www.swisstopo.admin.ch/ogd-conditions) – vor Produktivbetrieb durch den Verein zu bestätigen.",
        "fvw_tiles_per_zoom": json.dumps(per_zoom),
    }
    db.executemany("INSERT INTO metadata VALUES (?,?)", list(meta.items()))
    db.commit(); db.execute("VACUUM"); db.close()
    for s in srcs:
        s.close()
    print(f"Fertig: {total} Kacheln, {total_bytes/1e6:.1f} MB Bilddaten -> {a.out} ({os.path.getsize(a.out)/1e6:.1f} MB)")
    manifest = {k: v for k, v in meta.items()}
    manifest["file"] = os.path.basename(a.out)
    manifest["sha256"] = sha256(a.out)
    manifest["bytes"] = os.path.getsize(a.out)
    manifest["tiles"] = total
    json.dump(manifest, open(a.out + ".json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
