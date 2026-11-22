import type { Config } from '../config';
import { zurichDate } from '@fvw/shared';
import { fetchWithTimeout } from './status';

/** Ein Tageskarten-Ticket aus einer Eventfrog-Bestellung (nur die für den Gastzugang nötigen Felder). */
export interface EventfrogOrder {
  orderId: string;
  ticketNo: string | null;
  email: string;
  buyerName: string | null;
  /** Name der Ticketkategorie (falls ermittelbar), sonst die Kategorie-ID. */
  ticketType: string | null;
  /** Eventfrog-Kategorie-ID; Patentarten können auch über diese ID zugeordnet werden. */
  categoryId?: string | null;
  validFrom: string; // YYYY-MM-DD
  validTo: string;
  /** Ticket in Eventfrog storniert → Tageskarte sperren. */
  cancelled?: boolean;
}

/** Vom Vorstand im Admin festgelegte Abrufparameter. */
export interface EventfrogFetchOptions {
  /** IDs der Eventfrog-Events, über die Tageskarten verkauft werden. */
  eventIds: string[];
  /** Titel des Personalisierungsfelds mit dem Fischtag; null = Bestelldatum (Zürcher Zeit). */
  dateField: string | null;
}

export interface EventfrogAdapter {
  readonly mode: 'demo' | 'live' | 'off';
  describe(): { configured: boolean; detail: string };
  fetchOrders(opts: EventfrogFetchOptions): Promise<EventfrogOrder[]>;
}

/** Datum in Zürcher Zeit (nicht UTC), damit Demo-Tageskarten auch zwischen 0 und 1 Uhr «heute» gelten. */
function today(offsetDays = 0) {
  return zurichDate(new Date(Date.now() + offsetDays * 86400_000));
}

/** Fiktive Bestellungen relativ zum heutigen Datum (Demo). */
export function demoOrders(): EventfrogOrder[] {
  return [
    { orderId: 'DEMO-ORDER-1', ticketNo: 'DEMO-TK-0001', email: 'gast@demo.fvw.invalid', buyerName: 'Demo Gast', ticketType: 'Demo-Tageskarte Werdenberger Binnenkanal', validFrom: today(0), validTo: today(0) },
    { orderId: 'DEMO-ORDER-2', ticketNo: 'DEMO-TK-0002', email: 'gast@demo.fvw.invalid', buyerName: 'Demo Gast', ticketType: 'Demo-Tageskarte Werdenberger Binnenkanal', validFrom: today(-20), validTo: today(-20) },
    { orderId: 'DEMO-ORDER-3', ticketNo: 'DEMO-TK-0003', email: 'gast-abgelaufen@demo.fvw.invalid', buyerName: 'Demo Gast Abgelaufen', ticketType: 'Demo-Tageskarte Werdenberger Binnenkanal', validFrom: today(-40), validTo: today(-40) },
  ];
}

class DemoEventfrog implements EventfrogAdapter {
  readonly mode = 'demo' as const;
  describe() { return { configured: true, detail: 'Demo-Modus: fiktive Tageskarten-Bestellungen, keine Verbindung zu Eventfrog' }; }
  async fetchOrders(_opts?: EventfrogFetchOptions) { return demoOrders(); }
}

class OffEventfrog implements EventfrogAdapter {
  readonly mode = 'off' as const;
  describe() { return { configured: false, detail: 'Nicht eingerichtet (EVENTFROG_MODE=off)' }; }
  async fetchOrders(): Promise<EventfrogOrder[]> { throw new Error('Eventfrog ist nicht eingerichtet'); }
}

/** Datum aus einem Personalisierungsfeld lesen (31.12.2026, 31.12.26, 2026-12-31). */
export function parseDateValue(v: string): string | null {
  const s = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

/** Name einer Ticketkategorie; das Schema der Kategorie ist nicht dokumentiert, daher tolerant. */
function categoryName(c: any): string | null {
  if (typeof c?.name === 'string') return c.name;
  if (typeof c?.title === 'string') return c.title;
  const infos: any[] = Array.isArray(c?.localizedInfos) ? c.localizedInfos : [];
  const de = infos.find((i) => String(i.locale ?? '').toLowerCase().startsWith('de')) ?? infos[0];
  return typeof de?.title === 'string' ? de.title : typeof de?.name === 'string' ? de.name : null;
}

/** Wandelt die Antwort von GET /organizer/v1/events/{eventId}/tickettransactions in Tageskarten um. */
export function mapTransactions(transactions: any[], categories: Map<string, string>, dateField: string | null): EventfrogOrder[] {
  const field = dateField?.trim().toLowerCase() || null;
  const out: EventfrogOrder[] = [];
  for (const t of transactions) {
    if (t?.type === 'blocking') continue; // Reservationen/Sperrungen sind keine Verkäufe
    const email = String(t?.customer?.email ?? '').trim().toLowerCase();
    if (!t?.id || !email) continue;
    const buyerName = [t.customer?.firstname, t.customer?.lastname].filter(Boolean).join(' ').trim() || null;
    for (const tk of Array.isArray(t.tickets) ? t.tickets : []) {
      let day: string | null = null;
      if (field) {
        const p = (tk.personalizations ?? []).find((x: any) => (x.localizedInfos ?? []).some((i: any) => String(i.title ?? '').trim().toLowerCase() === field));
        if (p) day = parseDateValue(String(p.value ?? ''));
      }
      day ??= t.orderDate ? zurichDate(t.orderDate) : null;
      if (!day) continue;
      const categoryId = tk.categoryId != null ? String(tk.categoryId) : null;
      out.push({
        orderId: String(t.id), ticketNo: tk.id != null ? String(tk.id) : null, email, buyerName,
        ticketType: (categoryId && categories.get(categoryId)) ?? categoryId, categoryId,
        validFrom: day, validTo: day, cancelled: tk.cancelled === true,
      });
    }
  }
  return out;
}

/**
 * Eventfrog Organizer API v1 (Read), Host api.eventfrog.net, Bearer-Token.
 * Käufe: GET /organizer/v1/events/{eventId}/tickettransactions (seitenweise, max. 1000 pro Seite),
 * Ticketarten: GET /organizer/v1/events/{eventId}/ticketcategories.
 * Limits laut Eventfrog-Hilfe: 30 Anfragen/Minute, 2000/Tag pro Konto. Ein Abgleich braucht pro Event
 * 2 Anfragen (bei mehr als 1000 Käufen eine zusätzliche pro 1000).
 */
class LiveEventfrog implements EventfrogAdapter {
  readonly mode = 'live' as const;
  constructor(private cfg: Config, private fetchImpl: typeof fetchWithTimeout = fetchWithTimeout) {}
  describe() {
    return this.cfg.EVENTFROG_API_KEY
      ? { configured: true, detail: `Organizer API v1 ${this.cfg.EVENTFROG_BASE_URL}` }
      : { configured: false, detail: 'Nicht eingerichtet: es fehlt EVENTFROG_API_KEY' };
  }
  private async get(path: string, params: Record<string, string> = {}): Promise<any> {
    const url = new URL(path, this.cfg.EVENTFROG_BASE_URL.replace(/\/?$/, '/'));
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await this.fetchImpl(url.toString(), { headers: { Authorization: `Bearer ${this.cfg.EVENTFROG_API_KEY}`, Accept: 'application/json' } });
    if (res.status === 429) throw new Error('Eventfrog-Limit erreicht (HTTP 429) – später erneut');
    if (res.status === 401 || res.status === 403) throw new Error(`Eventfrog lehnt den API-Schlüssel ab (HTTP ${res.status}) – abgelaufen oder ohne Zugriff auf dieses Event?`);
    if (res.status === 404) throw new Error(`Eventfrog kennt ${path} nicht (HTTP 404) – Event-ID prüfen`);
    if (!res.ok) throw new Error(`Eventfrog antwortet mit HTTP ${res.status}`);
    return res.json();
  }
  async fetchOrders(opts: EventfrogFetchOptions): Promise<EventfrogOrder[]> {
    if (!this.describe().configured) throw new Error(this.describe().detail);
    const ids = opts.eventIds.map((s) => s.trim()).filter(Boolean);
    if (!ids.length) throw new Error('Keine Eventfrog-Event-ID festgelegt (Admin → Einstellungen → Tageskarten)');
    const all: EventfrogOrder[] = [];
    for (const id of ids) {
      if (!/^\d+$/.test(id)) throw new Error(`Ungültige Eventfrog-Event-ID «${id}» (nur Ziffern)`);
      const categories = new Map<string, string>();
      try {
        const cat = await this.get(`organizer/v1/events/${id}/ticketcategories`);
        for (const c of (Array.isArray(cat) ? cat : cat?.data ?? [])) { const n = categoryName(c); if (c?.id != null && n) categories.set(String(c.id), n); }
      } catch (e: any) {
        if (/HTTP 429/.test(e.message)) throw e; // sonst ohne Namen weiter: Zuordnung über Kategorie-ID
      }
      const tx: any[] = [];
      for (let page = 1; page <= 50; page++) {
        const r = await this.get(`organizer/v1/events/${id}/tickettransactions`, { page: String(page), perPage: '1000' });
        const data: any[] = r?.data ?? [];
        tx.push(...data);
        if (!data.length || tx.length >= Number(r?.totalNumberOfResources ?? 0)) break;
      }
      all.push(...mapTransactions(tx, categories, opts.dateField));
    }
    return all;
  }
}

export function createLiveEventfrogForTest(cfg: Config, fetchImpl: typeof fetchWithTimeout) { return new LiveEventfrog(cfg, fetchImpl); }

export function createEventfrogAdapter(cfg: Config): EventfrogAdapter {
  if (cfg.EVENTFROG_MODE === 'demo') return new DemoEventfrog();
  if (cfg.EVENTFROG_MODE === 'live') return new LiveEventfrog(cfg);
  return new OffEventfrog();
}
