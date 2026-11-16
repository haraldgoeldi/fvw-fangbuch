# Live-Abruf der My-Maps-Karten (Netzwerklinks)

Die hochgeladenen KMZ-Dateien enthalten **nur einen Netzwerklink** und keine Kartendaten.
Die vollständigen KML-Basisdateien (laut Anforderungsdokument ca. 760/220/20 KB) wurden
nicht bereitgestellt. Deshalb wurde der aktuelle Stand am **2026-11-15 ca. 16:50 UTC** über die
Netzwerklinks abgerufen (so wie es das Backend täglich tut).

Status dieser Dateien: **Live-Abruf, noch nicht als geprüfte Basisversion bestätigt.**
Ein Admin muss die Version im Adminbereich bestätigen (oder die geprüften KML-Exporte
nachreichen und importieren).

| Karte | My-Maps-ID | HTTP | Format | Grösse KML | SHA-256 KML |
|---|---|---|---|---|---|
| Aktive Fischer 2026 Gewässerkarte | `1ix9IEIuiCC-A4pySRwl-xYhhiiOMXf8` | 200 | KMZ (application/vnd.google-earth.kmz) | 759544 B | `70ddcbf308045a61cda6be0983d22551c23a6b0d31cdf16e829abb48363ae142` |
| Jugendfischer 2026 Gewässerkarte | `1gneLQ1JulxHv-ZE7Kz2pTtQEb32D_jM` | 200 | KMZ (application/vnd.google-earth.kmz) | 219086 B | `a2d9be0f2434b27453b8836abb824dcadfe4989ff446c9239b496df5e3a6a72e` |
| Gewässerkarte 2026 Tageskarte | `1GOP3PF7BT3ops0HwjviU5NQaVWDJgk0` | 200 | KMZ (application/vnd.google-earth.kmz) | 20269 B | `07205fe6be9ae5b5c05e2505ed41159f6e5dd783fc6a576887a1aa79aeec9313` |

Abruf-URL: `https://www.google.com/maps/d/kml?mid=<ID>` (Weiterleitung von `/maps/d/u/0/kml`). Die KMZ enthalten zusätzlich Ebenen-Icons unter `images/`; Fotos in den Beschreibungen verweisen auf `mymaps.usercontent.google.com` und sind nicht offline verfügbar.
