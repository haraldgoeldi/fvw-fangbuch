import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadEnvFile } from './cli/env';
import { migrate } from './cli/migrate';
import { loadConfig } from './config';
import { createContext } from './context';
import { startScheduler } from './jobs';

loadEnvFile();
const cfg = loadConfig();
const ctx = createContext(cfg);
await migrate(ctx);
if (ctx.signer.ephemeral) console.warn('WARNUNG: CREDENTIAL_SIGNING_KEY fehlt – Ausweise werden mit einem temporären Schlüssel signiert (nach Neustart ungültig).');
if (cfg.DEMO_MODE) console.warn('DEMO-MODUS aktiv: Mock-Integrationen, Demo-Codes sichtbar. Nicht für Produktion.');
const app = createApp(ctx);
if (cfg.JOBS_ENABLED) startScheduler(ctx);
serve({ fetch: app.fetch, port: cfg.PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`Fangbuch-Backend läuft auf http://localhost:${info.port} (Admin: ${cfg.PUBLIC_BASE_URL}/admin/) – Umgebung ${cfg.NODE_ENV}`);
});
