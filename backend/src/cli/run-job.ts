/** Einzelnen Hintergrundjob manuell ausführen: npm run jobs:run -w @fvw/backend -- map-check */
import { loadConfig } from '../config';
import { createContext } from '../context';
import { JOBS } from '../jobs';
import { loadEnvFile } from './env';
loadEnvFile();
const name = process.argv[2];
if (!name || !JOBS[name]) { console.log('Jobs:', Object.keys(JOBS).join(', ')); process.exit(1); }
const ctx = createContext(loadConfig());
JOBS[name].run(ctx).then((r) => { console.log(JSON.stringify(r, null, 2)); return ctx.db.end(); }).catch((e) => { console.error(e); process.exit(1); });
