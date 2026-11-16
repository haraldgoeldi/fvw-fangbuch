// Liefert den Web-Export der App (app/dist-web) mit COOP/COEP-Headern aus (nötig für expo-sqlite im Browser).
// node tools/dev/serve-web.mjs [port]
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../../app/dist-web');
const port = Number(process.argv[2] ?? 8790);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.mbtiles': 'application/octet-stream' };
createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let f = join(root, url);
  if (!f.startsWith(root) || !existsSync(f) || statSync(f).isDirectory()) f = join(root, 'index.html');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Content-Type', types[extname(f)] ?? 'application/octet-stream');
  res.end(readFileSync(f));
}).listen(port, () => console.log(`App (Web-Vorschau) auf http://localhost:${port}`));
