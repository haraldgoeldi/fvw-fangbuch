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
  /** Eventfrog-Event, aus dem das Ticket stammt. */
  eventId?: string | null;
}

/** Vom Vorstand im Admin festgelegte Abrufparameter. */
export interface EventfrogFetchOptions {
  /** Einzelne Eventfrog-Events, über die Tageskarten verkauft werden (immer abgefragt). */
  eventIds: string[];
  /** Eventfrog-Gruppen (z. B. «Tageskarten», ein Event pro Tag); abgefragt werden deren Events im Zeitfenster. */
  groupIds?: string[];
  /** Zeitfenster für Gruppen-Events (Event-Datum, Zürcher Zeit, YYYY-MM-DD, je inklusive). */
  fromDate?: string;
  toDate?: string;
  /** Titel des Personalisierungsfelds mit dem Fischtag; null = Datum des Events (sonst Bestelldatum). */
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

/**
 * Wandelt die Antwort von GET /organizer/v1/events/{eventId}/tickettransactions in Tageskarten um.
 * Fischtag: Personalisierungsfeld (falls festgelegt) → Datum des Events → Bestelldatum.
 */
export function mapTransactions(transactions: any[], categories: Map<string, string>, dateField: string | null, event: { id: string; day: string | null } | null = null): EventfrogOrder[] {
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
      day ??= event?.day ?? (t.orderDate ? zurichDate(t.orderDate) : null);
      if (!day) continue;
      const categoryId = tk.categoryId != null ? String(tk.categoryId) : null;
      out.push({
        orderId: String(t.id), ticketNo: tk.id != null ? String(tk.id) : null, email, buyerName,
        ticketType: (categoryId && categories.get(categoryId)) ?? categoryId, categoryId,
        validFrom: day, validTo: day, cancelled: tk.cancelled === true, eventId: event?.id ?? null,
      });
    }
  }
  return out;
}

/** Eventfrog-Event (nur die hier gebrauchten Felder). */
export interface EventfrogEvent { id: string; day: string | null }

/** Liste aus einer Eventfrog-Antwort (Array oder { data: [...] }). */
const listOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []);

/**
 * Eventfrog Organizer API v1 (Read), Host api.eventfrog.net, Bearer-Token.
 * Events: GET /organizer/v1/events (Filter id, groupId), Käufe: GET /organizer/v1/events/{eventId}/tickettransactions
 * (seitenweise, max. 1000 pro Seite), Ticketarten: GET /organizer/v1/events/{eventId}/ticketcategories.
 * Limits laut Eventfrog-Hilfe: 30 Anfragen/Minute, 2000/Tag pro Konto. Der Adapter hält sich selbst an
 * höchstens 25 Anfragen pro Minute, wartet bei HTTP 429 die von Eventfrog genannte Zeit ab und merkt sich
 * die Ticketarten pro Event 6 Stunden. Ein Abgleich braucht 1 Anfrage für die Gruppe plus 1 pro Event.
 */
class LiveEventfrog implements EventfrogAdapter {
  readonly mode = 'live' as const;
  private recent: number[] = [];
  private categoryCache = new Map<string, { at: number; map: Map<string, string> }>();
  constructor(private cfg: Config, private fetchImpl: typeof fetchWithTimeout = fetchWithTimeout,
    private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)), private clock: () => number = Date.now) {}
  describe() {
    return this.cfg.EVENTFROG_API_KEY
      ? { configured: true, detail: `Organizer API v1 ${this.cfg.EVENTFROG_BASE_URL}` }
      : { configured: false, detail: 'Nicht eingerichtet: es fehlt EVENTFROG_API_KEY' };
  }
  /** Höchstens 25 Anfragen pro gleitender Minute (Eventfrog erlaubt 30). */
  private async pace() {
    for (;;) {
      const now = this.clock();
      this.recent = this.recent.filter((t) => now - t < 60_000);
      if (this.recent.length < 25) { this.recent.push(now); return; }
      await this.sleep(60_000 - (now - this.recent[0]) + 50);
    }
  }
  private async get(path: string, params: Record<string, string | string[]> = {}, retried = false): Promise<any> {
    const url = new URL(path, this.cfg.EVENTFROG_BASE_URL.replace(/\/?$/, '/'));
    for (const [k, v] of Object.entries(params)) for (const x of Array.isArray(v) ? v : [v]) url.searchParams.append(k, x);
    await this.pace();
    const res = await this.fetchImpl(url.toString(), { headers: { Authorization: `Bearer ${this.cfg.EVENTFROG_API_KEY}`, Accept: 'application/json' } });
    if (res.status === 429) {
      const wait = Number(res.headers?.get?.('X-RateLimit-Retry-After-Seconds') ?? NaN);
      if (!retried && Number.isFinite(wait) && wait >= 0 && wait <= 120) { await this.sleep(wait * 1000 + 100); return this.get(path, params, true); }
      throw new Error('Eventfrog-Limit erreicht (HTTP 429) – später erneut');
    }
    if (res.status === 401 || res.status === 403) throw new Error(`Eventfrog lehnt den API-Schlüssel ab (HTTP ${res.status}) – abgelaufen oder ohne Zugriff auf dieses Event?`);
    if (res.status === 404) throw new Error(`Eventfrog kennt ${path} nicht (HTTP 404) – Event- bzw. Gruppen-ID prüfen`);
    if (!res.ok) throw new Error(`Eventfrog antwortet mit HTTP ${res.status}`);
    return res.json();
  }
  /** Events nach ID oder Gruppe, mit Datum in Zürcher Zeit. */
  private async listEvents(filter: { id?: string[]; groupId?: string[] }): Promise<EventfrogEvent[]> {
    const out: EventfrogEvent[] = [];
    for (let page = 1; page <= 20; page++) {
      const r = await this.get('organizer/v1/events', { ...(filter.id ? { id: filter.id } : {}), ...(filter.groupId ? { groupId: filter.groupId } : {}), page: String(page), perPage: '1000' });
      const data = listOf(r);
      for (const e of data) {
        if (e?.id == null) continue;
        const begin = e.beginDate ?? e.begin ?? e.startDate ?? null;
        out.push({ id: String(e.id), day: begin ? zurichDate(begin) : null });
      }
      if (!data.length || Array.isArray(r) || out.length >= Number(r?.totalNumberOfResources ?? 0)) break;
    }
    return out;
  }
  private async categories(eventId: string): Promise<Map<string, string>> {
    const hit = this.categoryCache.get(eventId);
    if (hit && this.clock() - hit.at < 6 * 3600_000) return hit.map;
    const map = new Map<string, string>();
    try {
      const cat = await this.get(`organizer/v1/events/${eventId}/ticketcategories`);
      for (const c of listOf(cat)) { const n = categoryName(c); if (c?.id != null && n) map.set(String(c.id), n); }
      this.categoryCache.set(eventId, { at: this.clock(), map });
    } catch (e: any) {
      if (/HTTP 429/.test(e.message)) throw e; // sonst ohne Namen weiter: Zuordnung über Kategorie-ID
    }
    return map;
  }
  async fetchOrders(opts: EventfrogFetchOptions): Promise<EventfrogOrder[]> {
    if (!this.describe().configured) throw new Error(this.describe().detail);
    const ids = opts.eventIds.map((s) => s.trim()).filter(Boolean);
    const groups = (opts.groupIds ?? []).map((s) => s.trim()).filter(Boolean);
    if (!ids.length && !groups.length) throw new Error('Keine Eventfrog-Gruppe und keine Event-ID festgelegt (Admin → Einstellungen → Tageskarten)');
    for (const id of [...ids, ...groups]) if (!/^\d+$/.test(id)) throw new Error(`Ungültige Eventfrog-ID «${id}» (nur Ziffern)`);
    const events = new Map<string, EventfrogEvent>();
    if (ids.length) {
      // Datum der fest eingetragenen Events; falls nicht abrufbar, gilt das Bestelldatum
      let known: EventfrogEvent[] = [];
      try { known = await this.listEvents({ id: ids }); } catch (e: any) { if (/HTTP 429|API-Schlüssel/.test(e.message)) throw e; }
      for (const id of ids) events.set(id, known.find((k) => k.id === id) ?? { id, day: null });
    }
    if (groups.length) {
      for (const e of await this.listEvents({ groupId: groups })) {
        if (opts.fromDate && (!e.day || e.day < opts.fromDate)) continue;
        if (opts.toDate && (!e.day || e.day > opts.toDate)) continue;
        if (!events.has(e.id)) events.set(e.id, e);
      }
    }
    const all: EventfrogOrder[] = [];
    for (const ev of events.values()) {
      const categories = await this.categories(ev.id);
      const tx: any[] = [];
      for (let page = 1; page <= 50; page++) {
        const r = await this.get(`organizer/v1/events/${ev.id}/tickettransactions`, { page: String(page), perPage: '1000' });
        const data: any[] = listOf(r);
        tx.push(...data);
        if (!data.length || tx.length >= Number(r?.totalNumberOfResources ?? 0)) break;
      }
      all.push(...mapTransactions(tx, categories, opts.dateField, ev));
    }
    return all;
  }
}

export function createLiveEventfrogForTest(cfg: Config, fetchImpl: typeof fetchWithTimeout, sleep?: (ms: number) => Promise<void>, clock?: () => number) {
  return new LiveEventfrog(cfg, fetchImpl, sleep, clock);
}

export function createEventfrogAdapter(cfg: Config): EventfrogAdapter {
  if (cfg.EVENTFROG_MODE === 'demo') return new DemoEventfrog();
  if (cfg.EVENTFROG_MODE === 'live') return new LiveEventfrog(cfg);
  return new OffEventfrog();
}
