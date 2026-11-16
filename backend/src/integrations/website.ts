import { XMLParser } from 'fast-xml-parser';
import type { Config } from '../config';
import { fetchWithTimeout } from './status';

export interface WebsiteEvent {
  externalId: string;
  title: string;
  startsAt: string; // ISO
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  url: string | null;
  description: string | null;
}

export interface WebsiteAdapter {
  readonly mode: 'off' | 'demo' | 'ical' | 'rss' | 'html';
  describe(): { configured: boolean; detail: string; fragile: boolean };
  fetchEvents(): Promise<WebsiteEvent[]>;
}

function isoDays(offset: number, hour = 9) {
  const d = new Date(Date.now() + offset * 86400_000);
  d.setUTCHours(hour - 1, 0, 0, 0);
  return d.toISOString();
}

class DemoWebsite implements WebsiteAdapter {
  readonly mode = 'demo' as const;
  describe() { return { configured: true, detail: 'Demo-Modus: fiktive Termine, keine Verbindung zur Vereinswebseite', fragile: false }; }
  async fetchEvents(): Promise<WebsiteEvent[]> {
    return [
      { externalId: 'demo-1', title: 'Demo-Termin: Arbeitseinsatz am Binnenkanal', startsAt: isoDays(12, 8), endsAt: isoDays(12, 12), allDay: false, location: 'Demo-Ort', url: null, description: 'Fiktiver Termin für den Demo-Modus.' },
      { externalId: 'demo-2', title: 'Demo-Termin: Vereinsversammlung', startsAt: isoDays(30, 19), endsAt: null, allDay: false, location: 'Demo-Ort', url: null, description: 'Fiktiver Termin für den Demo-Modus.' },
      { externalId: 'demo-3', title: 'Demo-Termin: Jungfischerkurs', startsAt: isoDays(45, 9), endsAt: isoDays(45, 16), allDay: false, location: 'Demo-Ort', url: null, description: 'Fiktiver Termin für den Demo-Modus.' },
    ];
  }
}

class OffWebsite implements WebsiteAdapter {
  readonly mode = 'off' as const;
  describe() { return { configured: false, detail: 'Nicht eingerichtet: Feed-URL der Vereinswebseite unbekannt (O13)', fragile: false }; }
  async fetchEvents(): Promise<WebsiteEvent[]> { throw new Error('Vereinswebseite nicht eingerichtet'); }
}

/** Minimaler iCalendar-Parser (VEVENT: UID, SUMMARY, DTSTART, DTEND, LOCATION, URL, DESCRIPTION). */
export function parseICal(text: string): WebsiteEvent[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const events: WebsiteEvent[] = [];
  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const prop = (name: string) => {
      const m = new RegExp(`^${name}(;[^:\\n]*)?:(.*)$`, 'm').exec(body);
      return m ? { params: m[1] ?? '', value: m[2].trim().replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';') } : null;
    };
    const dt = (p: { params: string; value: string } | null) => {
      if (!p) return null;
      const v = p.value;
      if (/^\d{8}$/.test(v)) return { iso: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T00:00:00Z`, allDay: true };
      const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
      if (!m) return null;
      // Ohne Z: lokale Zeit (Europe/Zurich) – Näherung über festen Offset der Jahreszeit
      const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? 'Z' : ''}`;
      return { iso: m[7] ? iso : new Date(iso + '+01:00').toISOString(), allDay: false };
    };
    const s = dt(prop('DTSTART'));
    const summary = prop('SUMMARY')?.value;
    if (!s || !summary) continue;
    const e = dt(prop('DTEND'));
    events.push({
      externalId: prop('UID')?.value ?? `${summary}-${s.iso}`, title: summary, startsAt: s.iso, endsAt: e?.iso ?? null, allDay: s.allDay,
      location: prop('LOCATION')?.value ?? null, url: prop('URL')?.value ?? null, description: prop('DESCRIPTION')?.value ?? null,
    });
  }
  return events;
}

export function parseRss(text: string): WebsiteEvent[] {
  const x = new XMLParser({ ignoreAttributes: false, isArray: (n) => n === 'item' || n === 'entry' }).parse(text);
  const items: any[] = x?.rss?.channel?.item ?? x?.feed?.entry ?? [];
  return items.map((it) => {
    const date = it['ev:startdate'] ?? it.pubDate ?? it.published ?? it.updated;
    return {
      externalId: String(it.guid?.['#text'] ?? it.guid ?? it.id ?? it.link?.['@_href'] ?? it.link ?? it.title),
      title: String(it.title?.['#text'] ?? it.title ?? ''), startsAt: new Date(date).toISOString(), endsAt: null, allDay: false,
      location: it['ev:location'] ?? null, url: typeof it.link === 'string' ? it.link : it.link?.['@_href'] ?? null,
      description: typeof it.description === 'string' ? it.description.replace(/<[^>]+>/g, '').slice(0, 500) : null,
    };
  }).filter((e) => e.title && !Number.isNaN(Date.parse(e.startsAt)));
}

/** HTML-Seite: nur strukturierte Daten (schema.org Event als JSON-LD). Störanfälliger als ein Feed. */
export function parseHtmlEvents(html: string, baseUrl: string): WebsiteEvent[] {
  const out: WebsiteEvent[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      const list = Array.isArray(data) ? data : data['@graph'] ?? [data];
      for (const d of list) {
        if (d['@type'] !== 'Event' || !d.startDate || !d.name) continue;
        out.push({ externalId: d.url ?? `${d.name}-${d.startDate}`, title: d.name, startsAt: new Date(d.startDate).toISOString(), endsAt: d.endDate ? new Date(d.endDate).toISOString() : null,
          allDay: /^\d{4}-\d{2}-\d{2}$/.test(d.startDate), location: d.location?.name ?? (typeof d.location === 'string' ? d.location : null), url: d.url ? new URL(d.url, baseUrl).toString() : null, description: d.description ?? null });
      }
    } catch { /* ungültiges JSON-LD ignorieren */ }
  }
  if (out.length === 0) throw new Error('Auf der Terminseite wurden keine strukturierten Termine (schema.org Event) gefunden – Seitenstruktur prüfen.');
  return out;
}

class FeedWebsite implements WebsiteAdapter {
  constructor(readonly mode: 'ical' | 'rss' | 'html', private cfg: Config) {}
  describe() {
    if (!this.cfg.WEBSITE_FEED_URL) return { configured: false, detail: 'WEBSITE_FEED_URL fehlt', fragile: this.mode === 'html' };
    return { configured: true, detail: `${this.mode.toUpperCase()}: ${this.cfg.WEBSITE_FEED_URL}${this.mode === 'html' ? ' (Seite auslesen – störanfällig)' : ''}`, fragile: this.mode === 'html' };
  }
  async fetchEvents() {
    if (!this.cfg.WEBSITE_FEED_URL) throw new Error('WEBSITE_FEED_URL fehlt');
    const res = await fetchWithTimeout(this.cfg.WEBSITE_FEED_URL);
    if (!res.ok) throw new Error(`Webseite antwortet mit HTTP ${res.status}`);
    const text = await res.text();
    if (this.mode === 'ical') return parseICal(text);
    if (this.mode === 'rss') return parseRss(text);
    return parseHtmlEvents(text, this.cfg.WEBSITE_FEED_URL);
  }
}

export function createWebsiteAdapter(cfg: Config): WebsiteAdapter {
  if (cfg.WEBSITE_MODE === 'demo') return new DemoWebsite();
  if (cfg.WEBSITE_MODE === 'off') return new OffWebsite();
  return new FeedWebsite(cfg.WEBSITE_MODE, cfg);
}
