import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import type { Config } from '../config';
import { fetchWithTimeout } from './status';

/** Mitgliedsdatensatz, wie das Backend ihn aus Fairgate übernimmt (Datenminimierung: nur diese Felder). */
export interface FairgateContact {
  fairgateId: string;
  memberNo: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  status: string;
  groups: string[];
}

export interface FairgateAdapter {
  readonly mode: 'demo' | 'live' | 'off';
  /** Status-Text für die Adminoberfläche. */
  describe(): { configured: boolean; detail: string };
  fetchContacts(): Promise<FairgateContact[]>;
}

/** Fiktive Demo-Kontakte (klar erkennbar, Domain .invalid). */
export const DEMO_CONTACTS: FairgateContact[] = [
  { fairgateId: 'demo-1001', memberNo: 'D-1001', firstName: 'Demo', lastName: 'Mitglied', email: 'mitglied@demo.fvw.invalid', status: 'aktiv', groups: [] },
  { fairgateId: 'demo-1002', memberNo: 'D-1002', firstName: 'Demo', lastName: 'Jugendfischer', email: 'jugend@demo.fvw.invalid', status: 'aktiv', groups: [] },
  { fairgateId: 'demo-1003', memberNo: 'D-1003', firstName: 'Demo', lastName: 'Aufseher', email: 'aufseher@demo.fvw.invalid', status: 'aktiv', groups: ['Demo-Aufseher'] },
  { fairgateId: 'demo-1004', memberNo: 'D-1004', firstName: 'Demo', lastName: 'Vorstand', email: 'vorstand@demo.fvw.invalid', status: 'aktiv', groups: ['Demo-Vorstand'] },
  { fairgateId: 'demo-1005', memberNo: 'D-1005', firstName: 'Demo', lastName: 'Ausgetreten', email: 'ausgetreten@demo.fvw.invalid', status: 'ausgetreten', groups: [] },
  { fairgateId: 'demo-1006', memberNo: 'D-1006', firstName: 'Demo', lastName: 'OhneEmail', email: null, status: 'aktiv', groups: [] },
];

class DemoFairgate implements FairgateAdapter {
  readonly mode = 'demo' as const;
  contacts = DEMO_CONTACTS.map((c) => ({ ...c }));
  describe() { return { configured: true, detail: 'Demo-Modus: fiktive Mitglieder, keine Verbindung zu Fairgate' }; }
  async fetchContacts() { return this.contacts.map((c) => ({ ...c })); }
}

class OffFairgate implements FairgateAdapter {
  readonly mode = 'off' as const;
  describe() { return { configured: false, detail: 'Nicht eingerichtet (FAIRGATE_MODE=off)' }; }
  async fetchContacts(): Promise<FairgateContact[]> { throw new Error('Fairgate ist nicht eingerichtet'); }
}

/**
 * Echter FSA-Adapter (nur lesend). Die FSA-Endpunkte sind in einer passwortgeschützten OpenAPI-
 * Dokumentation beschrieben, die für diesen Prototyp nicht zugänglich war. Pfad und Feldzuordnung sind
 * deshalb konfigurierbar und NICHT verifiziert (offener Punkt O7).
 * Laut öffentlicher FSA-Doku: Basis-URL fsa.fairgate.ch bzw. fsa-test.fairgate.ch, Access-Token pro
 * Anwendung, Antworten als JWT, Signatur mit dem öffentlichen Schlüssel von Fairgate prüfbar.
 */
class LiveFairgate implements FairgateAdapter {
  readonly mode = 'live' as const;
  constructor(private cfg: Config) {}
  describe() {
    const missing = [!this.cfg.FAIRGATE_TOKEN && 'FAIRGATE_TOKEN', !this.cfg.FAIRGATE_CONTACTS_PATH && 'FAIRGATE_CONTACTS_PATH', !this.cfg.FAIRGATE_PUBLIC_KEY && 'FAIRGATE_PUBLIC_KEY'].filter(Boolean);
    return missing.length
      ? { configured: false, detail: `Nicht eingerichtet: es fehlen ${missing.join(', ')}` }
      : { configured: true, detail: `FSA ${this.cfg.FAIRGATE_BASE_URL} (Endpunkt/Feldzuordnung nicht verifiziert)` };
  }
  async fetchContacts(): Promise<FairgateContact[]> {
    if (!this.describe().configured) throw new Error(this.describe().detail);
    const res = await fetchWithTimeout(`${this.cfg.FAIRGATE_BASE_URL}${this.cfg.FAIRGATE_CONTACTS_PATH}`, {
      headers: { Authorization: `Bearer ${this.cfg.FAIRGATE_TOKEN}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`FSA antwortet mit HTTP ${res.status}`);
    const text = (await res.text()).trim();
    let data: any;
    if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(text)) data = verifyJwt(text, this.cfg.FAIRGATE_PUBLIC_KEY!);
    else data = JSON.parse(text);
    const list: any[] = Array.isArray(data) ? data : data.data ?? data.contacts ?? data.items ?? [];
    const map = { id: 'id', memberNo: 'memberNumber', firstName: 'firstName', lastName: 'lastName', email: 'email', status: 'status', groups: 'groups', ...(this.cfg.FAIRGATE_FIELD_MAP ? JSON.parse(this.cfg.FAIRGATE_FIELD_MAP) : {}) };
    const get = (o: any, path: string) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
    return list.map((c) => ({
      fairgateId: String(get(c, map.id)),
      memberNo: get(c, map.memberNo) != null ? String(get(c, map.memberNo)) : null,
      firstName: String(get(c, map.firstName) ?? ''),
      lastName: String(get(c, map.lastName) ?? ''),
      email: get(c, map.email) ? String(get(c, map.email)).trim().toLowerCase() : null,
      status: String(get(c, map.status) ?? ''),
      groups: (get(c, map.groups) ?? []).map((g: any) => (typeof g === 'string' ? g : String(g?.name ?? g))),
    }));
  }
}

/** JWT-Prüfung (RS256/ES256) mit dem öffentlichen Schlüssel von Fairgate (PEM). */
export function verifyJwt(token: string, publicKeyPem: string): any {
  const [h, p, s] = token.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const alg = header.alg as string;
  const key = createPublicKey(publicKeyPem);
  const data = Buffer.from(`${h}.${p}`);
  const sig = Buffer.from(s, 'base64url');
  let ok = false;
  if (alg === 'RS256') ok = cryptoVerify('RSA-SHA256', data, key, sig);
  else if (alg === 'ES256') ok = cryptoVerify('SHA256', data, { key, dsaEncoding: 'ieee-p1363' }, sig);
  else throw new Error(`JWT-Algorithmus ${alg} wird nicht unterstützt`);
  if (!ok) throw new Error('JWT-Signatur von Fairgate ungültig');
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  if (payload.exp && payload.exp * 1000 < Date.now()) throw new Error('JWT von Fairgate abgelaufen');
  return payload.data ?? payload;
}

export function createFairgateAdapter(cfg: Config): FairgateAdapter {
  if (cfg.FAIRGATE_MODE === 'demo') return new DemoFairgate();
  if (cfg.FAIRGATE_MODE === 'live') return new LiveFairgate(cfg);
  return new OffFairgate();
}
