import { audit, SYSTEM } from './audit';
import type { AppContext } from './context';
import { syncGuestOrders, syncMembers } from './services/accounts';
import { syncEvents } from './services/content';
import { checkNetworkLinks } from './services/maps';
import { applyRetention } from './services/returns';

export const JOBS: Record<string, { everyMs: number; label: string; run: (ctx: AppContext) => Promise<unknown> }> = {
  'map-check': { everyMs: 24 * 3600_000, label: 'Tägliche Aktualitätsprüfung der Gewässerkarten', run: (ctx) => checkNetworkLinks(ctx) },
  'fairgate-sync': { everyMs: 6 * 3600_000, label: 'Mitgliederabgleich Fairgate', run: (ctx) => syncMembers(ctx) },
  'eventfrog-sync': { everyMs: 30 * 60_000, label: 'Tageskarten-Abgleich Eventfrog, nahe Tage (gestern bis 14 Tage voraus)', run: (ctx) => syncGuestOrders(ctx) },
  'eventfrog-sync-full': { everyMs: 24 * 3600_000, label: 'Tageskarten-Abgleich Eventfrog, alle künftigen Events (Vorverkauf, Stornierungen)', run: (ctx) => syncGuestOrders(ctx, SYSTEM, 'voll') },
  'website-events': { everyMs: 6 * 3600_000, label: 'Termine der Vereinswebseite', run: (ctx) => syncEvents(ctx) },
  'mail-retry': { everyMs: 5 * 60_000, label: 'E-Mail-Wiederholungsversuche', run: (ctx) => ctx.mail.retryPending() },
  retention: { everyMs: 24 * 3600_000, label: 'Löschfristen (nur wenn festgelegt)', run: (ctx) => applyRetention(ctx, SYSTEM, false) },
};

/** Einfacher In-Process-Scheduler. Für mehrere Server-Instanzen JOBS_ENABLED nur auf einer Instanz setzen. */
export function startScheduler(ctx: AppContext) {
  const timers: NodeJS.Timeout[] = [];
  for (const [name, job] of Object.entries(JOBS)) {
    const run = async () => {
      try { await job.run(ctx); } catch (e: any) {
        console.error(`Job ${name} fehlgeschlagen:`, e);
        await audit(ctx.db, SYSTEM, 'job_fehler', 'job', name, { fehler: String(e?.message ?? e) }).catch(() => {});
      }
    };
    timers.push(setTimeout(run, 5_000 + Math.random() * 10_000));
    timers.push(setInterval(run, job.everyMs));
  }
  return () => timers.forEach((t) => clearTimeout(t));
}
