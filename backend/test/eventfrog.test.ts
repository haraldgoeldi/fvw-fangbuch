import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { zurichDate } from '@fvw/shared';
import { loadConfig } from '../src/config';
import { one, q } from '../src/db';
import { createLiveEventfrogForTest, mapTransactions, parseDateValue } from '../src/integrations/eventfrog';
import { resetLiveLookupForTest, syncGuestOrders } from '../src/services/accounts';
import { setSetting } from '../src/settings';
import { api, login, setup, type T } from './helpers';

const EVENT = '1302163456789012200';
const cfg = loadConfig({ DATABASE_URL: 'postgres://x', BETTER_AUTH_SECRET: 'x'.repeat(40), EVENTFROG_MODE: 'live', EVENTFROG_API_KEY: 'test-key' });

/** Beispieltransaktion nach der Eventfrog-Spezifikation (GET …/tickettransactions). */
function tx(id: string, email: string, tickets: any[], extra: Record<string, unknown> = {}) {
  return { id, type: 'shop_order', orderDate: '2026-07-14T08:30:00Z', customer: { email, firstname: 'Erika', lastname: 'Muster' }, tickets, ...extra };
}
const ticket = (id: string, extra: Record<string, unknown> = {}) => ({ id, categoryId: 77, cancelled: false, currency: 'CHF', price: 3000, personalizations: [], ...extra });

/** Fake-Fetch, das die beiden Eventfrog-Endpunkte bedient und die Aufrufe protokolliert. */
function fakeEventfrog(state: { transactions: any[]; categories?: any; status?: number; events?: { id: string; groupId?: string; beginDate: string }[]; byEvent?: Record<string, any[]> }) {
  const calls: { url: string; auth: string | null }[] = [];
  const impl = async (url: string, init: any = {}) => {
    calls.push({ url, auth: init.headers?.Authorization ?? null });
    if (state.status) return new Response('{}', { status: state.status });
    const u = new URL(url);
    if (u.pathname === '/organizer/v1/events') {
      const ids = u.searchParams.getAll('id'), groups = u.searchParams.getAll('groupId');
      const data = (state.events ?? []).filter((e) => (ids.length && ids.includes(e.id)) || (groups.length && groups.includes(e.groupId ?? '')));
      return Response.json({ totalNumberOfResources: data.length, data });
    }
    const evId = u.pathname.split('/')[4];
    if (u.pathname.endsWith('/tickettransactions') && state.byEvent) {
      const list = state.byEvent[evId] ?? [];
      return Response.json({ totalNumberOfResources: list.length, data: list });
    }
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
      '/organizer/v1/events',
      `/organizer/v1/events/${EVENT}/ticketcategories`,
      `/organizer/v1/events/${EVENT}/tickettransactions`,
      `/organizer/v1/events/${EVENT}/tickettransactions`,
    ]);
    expect(f.calls.every((c) => c.auth === 'Bearer test-key')).toBe(true);
  });

  it('meldet fehlende Event-IDs und abgelehnte Schlüssel verständlich', async () => {
    const ok = fakeEventfrog({ transactions: [] });
    await expect(createLiveEventfrogForTest(cfg, ok.impl).fetchOrders({ eventIds: [], dateField: null })).rejects.toThrow(/Keine Eventfrog-Gruppe/);
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

  it('ohne Gruppe und Event-ID gibt es einen verständlichen Fehler', async () => {
    await setSetting(t.ctx.db, 'eventfrog.group_ids', [], null);
    const r = await syncGuestOrders(t.ctx);
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toMatch(/Gruppe/);
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

// ---------------------------------------------------------------- Tageskarten-Gruppe (ein Event pro Tag)

const GROUP = '7530708740393202205';
const dayIso = (offset: number) => zurichDate(new Date(Date.now() + offset * 86400_000));

describe('Eventfrog: Gruppe «Tageskarten», ein Event pro Tag', () => {
  it('nimmt das Datum des Events als Fischtag, nicht das Kaufdatum', () => {
    const [o] = mapTransactions([tx('1', 'a@b.ch', [ticket('X')], { orderDate: '2027-04-20T10:00:00Z' })], new Map(), null, { id: '9', day: '2027-05-01' });
    expect(o).toMatchObject({ validFrom: '2027-05-01', validTo: '2027-05-01', eventId: '9' });
  });

  it('findet die Events der Gruppe selbst und fragt nur das Zeitfenster ab', async () => {
    const f = fakeEventfrog({
      transactions: [],
      events: [
        { id: '101', groupId: GROUP, beginDate: '2027-05-01T04:00:00+02:00' },
        { id: '102', groupId: GROUP, beginDate: '2027-05-02T04:00:00+02:00' },
        { id: '103', groupId: GROUP, beginDate: '2027-06-30T04:00:00+02:00' },
      ],
      byEvent: { '101': [tx('7001', 'a@b.ch', [ticket('T1')], { orderDate: '2027-04-10T08:00:00Z' })], '102': [tx('7002', 'c@d.ch', [ticket('T2')])] },
    });
    const orders = await createLiveEventfrogForTest(cfg, f.impl).fetchOrders({ eventIds: [], groupIds: [GROUP], fromDate: '2027-04-30', toDate: '2027-05-14', dateField: null });
    expect(orders.map((o) => [o.ticketNo, o.validFrom])).toEqual([['T1', '2027-05-01'], ['T2', '2027-05-02']]);
    const paths = f.calls.map((c) => new URL(c.url).pathname);
    expect(paths).not.toContain('/organizer/v1/events/103/tickettransactions');
    expect(new URL(f.calls[0].url).searchParams.getAll('groupId')).toEqual([GROUP]);
  });

  it('merkt sich Ticketarten und hält sich an höchstens 25 Anfragen pro Minute', async () => {
    let now = 0;
    const waits: number[] = [];
    const f = fakeEventfrog({ transactions: [], events: Array.from({ length: 30 }, (_, i) => ({ id: String(200 + i), groupId: GROUP, beginDate: '2027-05-01T04:00:00+02:00' })), byEvent: {} });
    const ef = createLiveEventfrogForTest(cfg, f.impl, async (ms) => { waits.push(ms); now += ms; }, () => now);
    await ef.fetchOrders({ eventIds: [], groupIds: [GROUP], dateField: null });
    expect(f.calls.length).toBe(61); // 1 Gruppe + 30 × (Ticketarten + Käufe)
    expect(waits.length).toBeGreaterThan(0);
    const again = f.calls.length;
    await ef.fetchOrders({ eventIds: [], groupIds: [GROUP], dateField: null });
    expect(f.calls.length - again).toBe(31); // Ticketarten aus dem Zwischenspeicher
  });

  it('wartet bei HTTP 429 die genannte Zeit und versucht es einmal erneut', async () => {
    let first = true;
    const waits: number[] = [];
    const impl = (async (url: string) => {
      if (first) { first = false; return new Response('{}', { status: 429, headers: { 'X-RateLimit-Retry-After-Seconds': '3' } }); }
      return new URL(url).pathname === '/organizer/v1/events' ? Response.json({ totalNumberOfResources: 0, data: [] }) : Response.json({ data: [] });
    }) as any;
    await createLiveEventfrogForTest(cfg, impl, async (ms) => { waits.push(ms); }).fetchOrders({ eventIds: [], groupIds: [GROUP], dateField: null });
    expect(waits).toEqual([3100]);
  });
});

describe('Eventfrog: frisch gekauftes Ticket einlesen', () => {
  let t: T;
  const state: any = { transactions: [], events: [], byEvent: {} };
  beforeAll(async () => {
    t = await setup();
    t.ctx.eventfrog = createLiveEventfrogForTest(cfg, fakeEventfrog(state).impl, async () => {});
    await q(t.ctx.db, `INSERT INTO permit_type(name, kind, map_group, status, eventfrog_ticket_type) VALUES ('Tageskarte Voralpsee', 'tag', 'tageskarte', 'vorschlag', '77')`);
    state.events = [{ id: '301', groupId: GROUP, beginDate: `${dayIso(0)}T04:00:00+02:00` }, { id: '302', groupId: GROUP, beginDate: `${dayIso(1)}T04:00:00+02:00` }];
  }, 120_000);
  afterAll(async () => { await t?.ctx.db.end(); });

  it('kennt der Server das Ticket noch nicht, schlägt er es beim Einlesen sofort nach', async () => {
    resetLiveLookupForTest();
    state.byEvent = { '302': [tx('8001', 'morgen@example.ch', [ticket('4SFN7YQWM49D')])] };
    const r = await api(t, null, '/api/auth/request-code', { body: { ticketNo: '4sfn7yqwm49d' } });
    expect(r.status).toBe(200);
    expect(r.data.emailHint).toBe('m…@example.ch');
    const p = await one<any>(t.ctx.db, `SELECT valid_from::text AS d FROM permit WHERE external_ref='8001/4SFN7YQWM49D'`);
    expect(p.d).toBe(dayIso(1));
  });

  it('nach Kauf in der App genügt die Bestell-E-Mail, der Server holt die Bestellung sofort', async () => {
    resetLiveLookupForTest();
    state.byEvent['301'] = [tx('8002', 'heute@example.ch', [ticket('HEUTE00001')])];
    expect(await login(t, 'heute@example.ch')).toBeTruthy();
  });

  it('Anmeldung nur mit Ticketnummer erst, wenn der Vorstand «Ticket genügt» wählt', async () => {
    const denied = await api(t, null, '/api/auth/ticket-login', { body: { ticketNo: 'HEUTE00001' } });
    expect(denied.status).toBe(400);
    expect(denied.data.error ?? denied.data.code ?? JSON.stringify(denied.data)).toMatch(/code_required/);
    await setSetting(t.ctx.db, 'guest.ticket_login', 'ticket_genuegt', null);
    const ok = await api(t, null, '/api/auth/ticket-login', { body: { ticketNo: 'heute00001', device: 'test' } });
    expect(ok.status).toBe(200);
    const boot = await api(t, ok.data.token, '/api/app/bootstrap');
    expect(boot.data.me.kind).toBe('guest');
    expect(boot.data.permits.some((p: any) => p.currentlyValid)).toBe(true);
    const bad = await api(t, null, '/api/auth/ticket-login', { body: { ticketNo: 'GIBTESNICHT' } });
    expect(bad.status).toBe(400);
  });

  it('die öffentliche Konfiguration nennt Shop-Link und Anmeldeart für die App', async () => {
    await setSetting(t.ctx.db, 'eventfrog.shop_url', 'https://eventfrog.ch/tageskarten', null);
    const r = await api(t, null, '/api/public/config');
    expect(r.data).toMatchObject({ dayPassShopUrl: 'https://eventfrog.ch/tageskarten', ticketLogin: 'ticket_genuegt' });
  });
});
