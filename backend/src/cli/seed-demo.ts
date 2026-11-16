/**
 * Demo-Daten (nur DEMO_MODE): fiktive Personen über die Demo-Adapter, als «Demo» markierte Patentarten
 * ohne Preise/Bedingungen, Demo-Termine und je ein Beispielbeitrag. Keine echten Vereinsregeln oder Werte.
 *   npm run seed:demo -w @fvw/backend
 */
import { zurichDate } from '@fvw/shared';
import { loadConfig } from '../config';
import { createContext, type AppContext } from '../context';
import { one, q } from '../db';
import { newCredentialCode, syncGuestOrders, syncMembers } from '../services/accounts';
import { syncEvents } from '../services/content';
import { loadEnvFile } from './env';
import { importBundledMaps } from './import-maps';
import { migrate } from './migrate';

const DEMO_TYPES = [
  { name: 'Demo-Jahrespatent Aktive Fischer', kind: 'saison', mapGroup: 'aktive', ticket: null },
  { name: 'Demo-Jugendfischerpatent', kind: 'saison', mapGroup: 'jugend', ticket: null },
  { name: 'Demo-Tageskarte Werdenberger Binnenkanal', kind: 'tag', mapGroup: 'tageskarte', ticket: 'Demo-Tageskarte Werdenberger Binnenkanal' },
];

export async function seedDemo(ctx: AppContext) {
  if (!ctx.cfg.DEMO_MODE) throw new Error('seed:demo nur im DEMO_MODE');
  await importBundledMaps(ctx);
  const typeIds: Record<string, string> = {};
  for (const t of DEMO_TYPES) {
    const ex = await one<any>(ctx.db, 'SELECT id FROM permit_type WHERE name=$1', [t.name]);
    typeIds[t.mapGroup] = ex?.id ?? (await one<any>(ctx.db, `INSERT INTO permit_type(name, kind, map_group, status, is_demo, eventfrog_ticket_type, description)
      VALUES ($1,$2,$3,'vorschlag',true,$4,'Demo-Patentart für den Prototyp. Keine Preise, keine Bedingungen – Patentarten sind noch nicht beschlossen (O1).') RETURNING id`, [t.name, t.kind, t.mapGroup, t.ticket]))!.id;
  }
  await syncMembers(ctx);
  await syncGuestOrders(ctx);
  await syncEvents(ctx);
  // Rollen (Rollenquelle «App»)
  await q(ctx.db, `UPDATE person SET roles='{warden}' WHERE email='aufseher@demo.fvw.invalid'`);
  await q(ctx.db, `UPDATE person SET roles='{admin}' WHERE email='vorstand@demo.fvw.invalid'`);
  // Demo-Patente für die Saison 2026
  const year = new Date().getUTCFullYear();
  const give = async (email: string, group: string) => {
    const p = await one<any>(ctx.db, `SELECT id FROM person WHERE email=$1 AND kind='member'`, [email]);
    if (!p) return;
    const has = await one(ctx.db, 'SELECT id FROM permit WHERE person_id=$1 AND permit_type_id=$2', [p.id, typeIds[group]]);
    if (!has) await q(ctx.db, `INSERT INTO permit(person_id, permit_type_id, season_year, valid_from, valid_to, status, payment_status, source, credential_code, note)
      VALUES ($1,$2,$3,$4,$5,'aktiv','unbekannt','demo',$6,'Demo-Patent')`, [p.id, typeIds[group], year, `${year}-01-01`, `${year}-12-31`, newCredentialCode()]);
  };
  await give('mitglied@demo.fvw.invalid', 'aktive');
  await give('jugend@demo.fvw.invalid', 'jugend');
  await give('mitglied@demo.fvw.invalid', 'jugend'); // zwei Berechtigungen → Kartenwechsel testbar
  await give('vorstand@demo.fvw.invalid', 'aktive');
  await give('aufseher@demo.fvw.invalid', 'aktive');
  // Beispielbeiträge (klar als Demo gekennzeichnet)
  const hasNews = await one(ctx.db, `SELECT id FROM news WHERE title LIKE 'Demo:%' LIMIT 1`);
  if (!hasNews) {
    await q(ctx.db, `INSERT INTO news(title, body, category, visibility) VALUES ('Demo: Willkommen in der Fangbuch-App', 'Dies ist ein Demo-Beitrag. Im Demo-Modus werden keine E-Mails, Push-Nachrichten oder Daten an Dritte gesendet.', 'verein', 'alle')`);
    await q(ctx.db, `INSERT INTO news(title, body, category, water_key, water_name, condition, visibility, expires_at) VALUES
      ('Demo: Gewässerzustand Voralpsee', 'Demo-Zustandsmeldung zur Veranschaulichung.', 'gewaesserzustand', 'voralpsee', 'Voralpsee', '{"waterLevel":"Demo-Angabe","turbidity":"Demo-Angabe","ice":null,"closureNote":null}', 'alle', now() + interval '14 days')`);
    await q(ctx.db, `INSERT INTO news(title, body, category, visibility, published_at, expires_at) VALUES ('Demo: Abgelaufene Meldung', 'Dieser Demo-Beitrag ist abgelaufen und wird als abgelaufen gekennzeichnet.', 'gewaesserzustand', 'mitglieder', now() - interval '20 days', now() - interval '5 days')`);
  }
  return { ok: true, today: zurichDate(new Date()) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnvFile();
  const ctx = createContext(loadConfig());
  migrate(ctx).then(() => seedDemo(ctx)).then((r) => { console.log('Demo-Daten erstellt', r); return ctx.db.end(); }).catch((e) => { console.error(e); process.exit(1); });
}
