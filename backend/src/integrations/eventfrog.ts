import type { Config } from '../config';
import { fetchWithTimeout } from './status';

/** Tageskarten-Bestellung (nur die für den Gastzugang nötigen Felder). */
export interface EventfrogOrder {
  orderId: string;
  ticketNo: string | null;
  email: string;
  buyerName: string | null;
  ticketType: string | null;
  validFrom: string; // YYYY-MM-DD
  validTo: string;
}

export interface EventfrogAdapter {
  readonly mode: 'demo' | 'live' | 'off';
  describe(): { configured: boolean; detail: string };
  fetchOrders(since: string | null): Promise<EventfrogOrder[]>;
}

function today(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400_000);
  return d.toISOString().slice(0, 10);
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
  async fetchOrders() { return demoOrders(); }
}

class OffEventfrog implements EventfrogAdapter {
  readonly mode = 'off' as const;
  describe() { return { configured: false, detail: 'Nicht eingerichtet (EVENTFROG_MODE=off)' }; }
  async fetchOrders(): Promise<EventfrogOrder[]> { throw new Error('Eventfrog ist nicht eingerichtet'); }
}

/**
 * Eventfrog Organizer API (Read), Host api.eventfrog.net. Limits laut Eventfrog-Hilfe:
 * 30 Anfragen/Minute, 2000/Tag pro Konto; Schlüssel laufen ab. Die konkrete Ressource für
 * Bestellungen/Käufer ist nicht verifiziert (API-Referenz docs.api.eventfrog.net war nicht zugänglich),
 * daher Pfad und Feldzuordnung konfigurierbar (offener Punkt O11).
 */
class LiveEventfrog implements EventfrogAdapter {
  readonly mode = 'live' as const;
  constructor(private cfg: Config) {}
  describe() {
    const missing = [!this.cfg.EVENTFROG_API_KEY && 'EVENTFROG_API_KEY', !this.cfg.EVENTFROG_ORDERS_PATH && 'EVENTFROG_ORDERS_PATH'].filter(Boolean);
    return missing.length
      ? { configured: false, detail: `Nicht eingerichtet: es fehlen ${missing.join(', ')}` }
      : { configured: true, detail: `Organizer API ${this.cfg.EVENTFROG_BASE_URL} (Endpunkt/Feldzuordnung nicht verifiziert)` };
  }
  async fetchOrders(since: string | null): Promise<EventfrogOrder[]> {
    if (!this.describe().configured) throw new Error(this.describe().detail);
    const url = new URL(`${this.cfg.EVENTFROG_BASE_URL}${this.cfg.EVENTFROG_ORDERS_PATH}`);
    if (since) url.searchParams.set('modifiedSince', since);
    const res = await fetchWithTimeout(url.toString(), { headers: { Authorization: `Bearer ${this.cfg.EVENTFROG_API_KEY}`, Accept: 'application/json' } });
    if (res.status === 429) throw new Error('Eventfrog-Limit erreicht (HTTP 429) – später erneut');
    if (!res.ok) throw new Error(`Eventfrog antwortet mit HTTP ${res.status}`);
    const data: any = await res.json();
    const list: any[] = Array.isArray(data) ? data : data.data ?? data.items ?? data.orders ?? [];
    const map = { orderId: 'orderId', ticketNo: 'ticketNumber', email: 'buyer.email', buyerName: 'buyer.name', ticketType: 'ticketCategory', validFrom: 'validFrom', validTo: 'validTo', ...(this.cfg.EVENTFROG_FIELD_MAP ? JSON.parse(this.cfg.EVENTFROG_FIELD_MAP) : {}) };
    const get = (o: any, path: string) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
    return list
      .map((o) => ({
        orderId: String(get(o, map.orderId) ?? ''),
        ticketNo: get(o, map.ticketNo) != null ? String(get(o, map.ticketNo)) : null,
        email: String(get(o, map.email) ?? '').trim().toLowerCase(),
        buyerName: get(o, map.buyerName) ?? null,
        ticketType: get(o, map.ticketType) ?? null,
        validFrom: String(get(o, map.validFrom) ?? '').slice(0, 10),
        validTo: String(get(o, map.validTo) ?? get(o, map.validFrom) ?? '').slice(0, 10),
      }))
      .filter((o) => o.orderId && o.email && /^\d{4}-\d{2}-\d{2}$/.test(o.validFrom));
  }
}

export function createEventfrogAdapter(cfg: Config): EventfrogAdapter {
  if (cfg.EVENTFROG_MODE === 'demo') return new DemoEventfrog();
  if (cfg.EVENTFROG_MODE === 'live') return new LiveEventfrog(cfg);
  return new OffEventfrog();
}
