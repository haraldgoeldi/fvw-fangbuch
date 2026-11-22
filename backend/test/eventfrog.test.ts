import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { one, q } from '../src/db';
import { createLiveEventfrogForTest, mapTransactions, parseDateValue } from '../src/integrations/eventfrog';
import { syncGuestOrders } from '../src/services/accounts';
import { setSetting } from '../src/settings';
import { login, setup, type T } from './helpers';

const EVENT = '1302163456789012200';
const cfg = loadConfig({ DATABASE_URL: 'postgres://x', BETTER_AUTH_SECRET: 'x'.repeat(40), EVENTFROG_MODE: 'live', EVENTFROG_API_KEY: 'test-key' });

/** Beispieltransaktion nach der Eventfrog-Spezifikation (GET …/tickettransactions). */
function tx(id: string, email: string, tickets: any[], extra: Record<string, unknown> = {}) {
  return { id, type: 'shop_order', orderDate: '2026-07-14T08:30:00Z', customer: { email, firstname: 'Erika', lastname: 'Muster' }, tickets, ...extra };
}
const ticket = (id: string, extra: Record<string, unknown> = {}) => ({ id, categoryId: 77, cancelled: false, currency: 'CHF', price: 3000, personalizations: [], ...extra });

/** Fake-Fetch, das die beiden Eventfrog-Endpunkte bedient und die Aufrufe protokolliert. */
function fakeEventfrog(state: { transactions: any[]; categories?: any; status?: number }) {
  const calls: { url: string; auth: string | null }[] = [];
  const impl = async (url: string, init: any = {}) => {
    calls.push({ url, auth: init.headers?.Authorization ?? null });
    if (state.status) return new Response('{}', { status: state.status });
    const u = new URL(url);
    if (u.pathname.endsWith('/ticketcategories')) return Response.json(state.categories ?? { data: [{ id: 77, name: 'Tageskarte Binnenkanal' }] });
    if (u.pathname.endsWith('/tickettransactions')) {
      const page = Number(u.searchParams.get('page')), per = Number(u.searchParams.get('perPage'));
      return Response.json({ totalNumberOfResources: state.transactions.length, data: state.transactions.slice((page - 1) * per, page * per) });
    }
    return new Response('{}', { status: 404 });
  };
  return { calls, impl: impl as any };
}

describe('Eventfrog: Umwandlung der Ticket-Transaktionen', () => {
  it('liest Datumsangaben aus Personalisierungsfeldern', () => {
    expect(parseDateValue('03.08.2026')).toBe('2026-08-03');
    expect(parseDateValue('3.8.26')).toBe('2026-08-03');
    expect(parseDateValue('2026-08-03')).toBe('2026-08-03');
    expect(parseDateValue('morgen')).toBeNull();
  });

  it('macht aus jedem Ticket eine Tageskarte, überspringt Sperrungen und nutzt Zürcher Datum', () => {
    const cats = new Map([['77', 'Tageskarte Binnenkanal']]);
    const list = mapTransactions([
      tx('1001', 'Gast@Example.ch', [ticket('A1'), ticket('A2', { cancelled: true })], { orderDate: '2026-07-14T22:30:00Z' }),
      tx('1002', 'block@example.ch', [ticket('B1')], { type: 'blocking' }),
      tx('1003', '', [ticket('C1')]),
    ], cats, null);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ orderId: '1001', ticketNo: 'A1', email: 'gast@example.ch', buyerName: 'Erika Muster', ticketType: 'Tageskarte Binnenkanal', categoryId: '77', validFrom: '2026-07-15', validTo: '2026-07-15', cancelled: false });
    expect(list[1]).toMatchObject({ ticketNo: 'A2', cancelled: true });
  });

  it('nimmt den Fischtag aus dem festgelegten Personalisierungsfeld', () => {
    const p = [{ fieldId: 'f1', value: '02.09.2026', localizedInfos: [{ locale: 'de_CH', title: 'Fischtag' }] }];
    const [o] = mapTransactions([tx('1', 'a@b.ch', [ticket('X', { personalizations: p })])], new Map(), 'fischtag');
    expect(o.validFrom).toBe('2026-09-02');
    expect(o.ticketType).toBe('77'); // ohne Kategorienamen bleibt die Kategorie-ID
  });
});

describe('Eventfrog: Abruf über die Organizer API v1', () => {
  it('ruft Kategorien und alle Seiten der Transaktionen mit Bearer-Token ab', async () => {
    const many = Array.from({ length: 1500 }, (_, i) => tx(String(i + 1), `g${i}@example.ch`, [ticket(`T${i}`)]));
    const f = fakeEventfrog({ transactions: many });
    const orders = await createLiveEventfrogForTest(cfg, f.impl).fetchOrders({ eventIds: [EVENT], dateField: null });
    expect(orders).toHaveLength(1500);
    expect(f.calls.map((c) => new URL(c.url).pathname)).toEqual([
      `/organizer/v1/events/${EVENT}/ticketcategories`,
      `/organizer/v1/events/${EVENT}/tickettransactions`,
      `/organizer/v1/events/${EVENT}/tickettransactions`,
    ]);
    expect(f.calls.every((c) => c.auth === 'Bearer test-key')).toBe(true);
  });

  it('meldet fehlende Event-IDs und abgelehnte Schlüssel verständlich', async () => {
    const ok = fakeEventfrog({ transactions: [] });
    await expect(createLiveEventfrogForTest(cfg, ok.impl).fetchOrders({ eventIds: [], dateField: null })).rejects.toThrow(/Keine Eventfrog-Event-ID/);
    const denied = fakeEventfrog({ transactions: [], status: 401 });
    await expect(createLiveEventfrogForTest(cfg, denied.impl).fetchOrders({ eventIds: [EVENT], dateField: null })).rejects.toThrow(/API-Schlüssel/);
  });
});

describe('Eventfrog: Abgleich legt Tageskarten an und sperrt Stornierungen', () => {
  let t: T;
  const state = { transactions: [] as any[] };
  const today = new Date().toISOString();
  beforeAll(async () => {
    t = await setup();
    t.ctx.eventfrog = createLiveEventfrogForTest(cfg, fakeEventfrog(state).impl);
    await q(t.ctx.db, `INSERT INTO permit_type(name, kind, map_group, status, eventfrog_ticket_type) VALUES ('Tageskarte Binnenkanal', 'tag', 'tageskarte', 'vorschlag', 'Tageskarte Binnenkanal')`);
  }, 120_000);
  afterAll(async () => { await t?.ctx.db.end(); });

  it('ohne Event-ID gibt es einen verständlichen Fehler', async () => {
    const r = await syncGuestOrders(t.ctx);
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toMatch(/Event-ID/);
  });

  it('legt Gast und Tageskarte an, Gast kann sich anmelden', async () => {
    await setSetting(t.ctx.db, 'eventfrog.event_ids', [EVENT], null);
    state.transactions = [tx('5001', 'neu.gast@example.ch', [ticket('V-1')], { orderDate: today })];
    const r = await syncGuestOrders(t.ctx);
    expect(r).toMatchObject({ ok: true, total: 1, created: 1, unmapped: 0 });
    const p = await one<any>(t.ctx.db, `SELECT status, source FROM permit WHERE external_ref='5001/V-1'`);
    expect(p).toMatchObject({ status: 'aktiv', source: 'eventfrog' });
    expect(await login(t, 'neu.gast@example.ch')).toBeTruthy();
    // erneuter Abgleich legt nichts doppelt an
    expect(await syncGuestOrders(t.ctx)).toMatchObject({ created: 0 });
  });

  it('sperrt die Tageskarte, wenn das Ticket in Eventfrog storniert wird', async () => {
    state.transactions = [tx('5001', 'neu.gast@example.ch', [ticket('V-1', { cancelled: true })], { orderDate: today })];
    expect(await syncGuestOrders(t.ctx)).toMatchObject({ ok: true, cancelled: 1 });
    expect(await one<any>(t.ctx.db, `SELECT status FROM permit WHERE external_ref='5001/V-1'`)).toMatchObject({ status: 'gesperrt' });
  });

  it('ordnet auch über die Kategorie-ID zu und zählt fehlende Zuordnungen', async () => {
    await q(t.ctx.db, `UPDATE permit_type SET eventfrog_ticket_type='88' WHERE name='Tageskarte Binnenkanal'`);
    state.transactions = [
      tx('5002', 'id.gast@example.ch', [ticket('V-2', { categoryId: 88 })], { orderDate: today }),
      tx('5003', 'ohne@example.ch', [ticket('V-3', { categoryId: 99 })], { orderDate: today }),
    ];
    expect(await syncGuestOrders(t.ctx)).toMatchObject({ ok: true, created: 1, unmapped: 1 });
  });

  it('lehnt Event-IDs mit Buchstaben im Admin ab', async () => {
    const { validateSetting } = await import('../src/settings');
    expect(validateSetting('eventfrog.event_ids', ['12ab'])).toMatch(/Ziffern/);
    expect(validateSetting('eventfrog.event_ids', [EVENT])).toBeNull();
  });
});
