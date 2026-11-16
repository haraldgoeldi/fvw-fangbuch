import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Lädt backend/.env bzw. die Datei aus ENV_FILE (ohne bestehende Variablen zu überschreiben). */
export function loadEnvFile() {
  const file = process.env.ENV_FILE ?? resolve(import.meta.dirname, '../../.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const v = m[2].replace(/^"(.*)"$/, '$1');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
